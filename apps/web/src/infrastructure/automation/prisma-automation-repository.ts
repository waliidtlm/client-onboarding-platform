import { randomUUID } from "node:crypto";

import {
  AutomationClaimOutcome,
  AutomationEventStatus,
  AutomationFailureClassification,
  AutomationRunStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import type { ClaimAutomationInput } from "@/application/automation/contracts";
import { toAutomationEventEnvelope } from "@/application/automation/event-service";
import type { AutomationClaimResult } from "@/application/automation/types";
import {
  automationRunIdempotencyKey,
  isSupportedAutomationEnvelope,
} from "@/domain/automation/idempotency";

type TransactionClient = Prisma.TransactionClient;

type LockedEvent = Readonly<{
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  schemaVersion: number;
  attemptCount: number;
  maxAttempts: number;
  occurredAt: Date;
  correlationId: string;
  currentRunId: string | null;
  status: AutomationEventStatus;
}>;

export type RepositoryClaimResult =
  | AutomationClaimResult
  | Readonly<{ kind: "CONFLICT"; code: "CLAIM_REQUEST_CONFLICT" }>
  | Readonly<{
      kind: "REJECTED";
      code: "INVALID_EVENT_INTEGRITY" | "INVALID_EVENT_SCHEMA" | "UNSUPPORTED_EVENT_TYPE";
    }>;

async function terminalizeRun(
  tx: TransactionClient,
  input: Readonly<{
    runId: string;
    status: AutomationRunStatus;
    errorCode: string;
    errorMessage: string;
    classification: AutomationFailureClassification;
  }>,
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    UPDATE "AutomationRun"
    SET
      "status" = ${input.status}::"AutomationRunStatus",
      "completedAt" = CURRENT_TIMESTAMP,
      "errorCode" = ${input.errorCode},
      "errorMessage" = ${input.errorMessage},
      "failureClassification" = ${input.classification}::"AutomationFailureClassification",
      "failureReportedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.runId}::uuid
  `);
}

async function recoverExhaustedLeases(tx: TransactionClient): Promise<void> {
  const expired = await tx.$queryRaw<Array<{ id: string; currentRunId: string }>>(Prisma.sql`
    SELECT "id", "currentRunId"
    FROM "AutomationEvent"
    WHERE "status" = 'PROCESSING'::"AutomationEventStatus"
      AND "leaseExpiresAt" <= CURRENT_TIMESTAMP
      AND "attemptCount" >= "maxAttempts"
      AND "currentRunId" IS NOT NULL
    ORDER BY "leaseExpiresAt" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 20
  `);

  for (const event of expired) {
    await terminalizeRun(tx, {
      runId: event.currentRunId,
      status: AutomationRunStatus.TIMED_OUT,
      errorCode: "LEASE_EXPIRED",
      errorMessage: "The worker lease expired before completion.",
      classification: AutomationFailureClassification.PERMANENT,
    });
    await tx.automationEvent.update({
      where: { id: event.id },
      data: {
        status: AutomationEventStatus.DEAD_LETTER,
        currentRunId: null,
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastErrorCode: "ATTEMPTS_EXHAUSTED",
        lastError: "The final worker lease expired.",
      },
    });
  }
}

async function responseForReceipt(
  tx: TransactionClient,
  requestId: string,
): Promise<RepositoryClaimResult> {
  const receipt = await tx.automationClaimRequest.findUniqueOrThrow({
    where: { requestId },
  });
  if (receipt.outcome === AutomationClaimOutcome.EMPTY) {
    return { kind: "EMPTY", idempotent: true };
  }
  if (receipt.outcome === AutomationClaimOutcome.REJECTED) {
    return {
      kind: "REJECTED",
      code: receipt.errorCode as
        "INVALID_EVENT_INTEGRITY" | "INVALID_EVENT_SCHEMA" | "UNSUPPORTED_EVENT_TYPE",
    };
  }
  if (receipt.outcome !== AutomationClaimOutcome.CLAIMED || !receipt.automationEventId) {
    return { kind: "CONFLICT", code: "CLAIM_REQUEST_CONFLICT" };
  }
  const [event, run] = await Promise.all([
    tx.automationEvent.findUniqueOrThrow({ where: { id: receipt.automationEventId } }),
    tx.automationRun.findUniqueOrThrow({ where: { claimRequestId: requestId } }),
  ]);
  return {
    kind: "CLAIMED",
    idempotent: true,
    event: toAutomationEventEnvelope(event),
    run: {
      runId: run.id,
      workerId: run.workerId,
      workflowName: run.workflowName,
      idempotencyKey: run.idempotencyKey,
      attemptNumber: run.attemptNumber,
      startedAt: run.startedAt.toISOString(),
      leaseExpiresAt: event.leaseExpiresAt?.toISOString() ?? event.availableAt.toISOString(),
    },
  };
}

function envelopeError(
  event: LockedEvent,
): "INVALID_EVENT_INTEGRITY" | "INVALID_EVENT_SCHEMA" | "UNSUPPORTED_EVENT_TYPE" | null {
  if (event.eventType !== "ONBOARDING_ACTIVATED" || event.aggregateType !== "ONBOARDING") {
    return "UNSUPPORTED_EVENT_TYPE";
  }
  if (event.schemaVersion !== 1) {
    return "INVALID_EVENT_SCHEMA";
  }
  if (
    !isSupportedAutomationEnvelope(event) ||
    event.payload === null ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload) ||
    Object.keys(event.payload as object).length !== 0
  ) {
    return "INVALID_EVENT_INTEGRITY";
  }
  return null;
}

export async function claimNextAutomationEvent(
  database: PrismaClient,
  input: ClaimAutomationInput,
  config: Readonly<{
    leaseSeconds: number;
    claimReceiptSeconds: number;
  }>,
): Promise<RepositoryClaimResult> {
  return database.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      DELETE FROM "AutomationClaimRequest"
      WHERE "requestId" IN (
        SELECT "requestId"
        FROM "AutomationClaimRequest"
        WHERE "expiresAt" <= CURRENT_TIMESTAMP
        ORDER BY "expiresAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 100
      )
    `);

    const inserted = await tx.$queryRaw<Array<{ requestId: string }>>(Prisma.sql`
      INSERT INTO "AutomationClaimRequest" (
        "requestId", "workerId", "workflowName", "outcome", "expiresAt", "createdAt"
      )
      VALUES (
        ${input.requestId}::uuid,
        ${input.workerId},
        ${input.workflowName},
        'PENDING'::"AutomationClaimOutcome",
        CURRENT_TIMESTAMP + make_interval(secs => ${config.claimReceiptSeconds}),
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("requestId") DO NOTHING
      RETURNING "requestId"
    `);

    if (inserted.length === 0) {
      const existing = await tx.automationClaimRequest.findUniqueOrThrow({
        where: { requestId: input.requestId },
      });
      if (existing.workerId !== input.workerId || existing.workflowName !== input.workflowName) {
        return { kind: "CONFLICT", code: "CLAIM_REQUEST_CONFLICT" };
      }
      return responseForReceipt(tx, input.requestId);
    }

    await recoverExhaustedLeases(tx);

    const candidates = await tx.$queryRaw<LockedEvent[]>(Prisma.sql`
      SELECT
        "id", "eventType", "aggregateType", "aggregateId", "payload", "schemaVersion",
        "attemptCount", "maxAttempts", "occurredAt", "correlationId", "currentRunId", "status"
      FROM "AutomationEvent"
      WHERE (
          ("status" = 'PENDING'::"AutomationEventStatus" AND "availableAt" <= CURRENT_TIMESTAMP)
          OR
          ("status" = 'PROCESSING'::"AutomationEventStatus" AND "leaseExpiresAt" <= CURRENT_TIMESTAMP)
        )
        AND "attemptCount" < "maxAttempts"
      ORDER BY "availableAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    const event = candidates[0];
    if (!event) {
      await tx.automationClaimRequest.update({
        where: { requestId: input.requestId },
        data: { outcome: AutomationClaimOutcome.EMPTY },
      });
      return { kind: "EMPTY", idempotent: false };
    }

    if (event.status === AutomationEventStatus.PROCESSING) {
      if (!event.currentRunId) {
        throw new Error("Processing automation event has no current run");
      }
      await terminalizeRun(tx, {
        runId: event.currentRunId,
        status: AutomationRunStatus.TIMED_OUT,
        errorCode: "LEASE_EXPIRED",
        errorMessage: "The worker lease expired before completion.",
        classification: AutomationFailureClassification.RETRYABLE,
      });
      await tx.automationEvent.update({
        where: { id: event.id },
        data: {
          status: AutomationEventStatus.PENDING,
          currentRunId: null,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          lastErrorCode: "LEASE_EXPIRED",
          lastError: "The previous worker lease expired.",
        },
      });
    }

    const attemptNumber = event.attemptCount + 1;
    const runId = randomUUID();
    const nowRows = await tx.$queryRaw<Array<{ now: Date; leaseExpiresAt: Date }>>(Prisma.sql`
      SELECT
        CURRENT_TIMESTAMP AS "now",
        CURRENT_TIMESTAMP + make_interval(secs => ${config.leaseSeconds}) AS "leaseExpiresAt"
    `);
    const now = nowRows[0]!.now;
    const leaseExpiresAt = nowRows[0]!.leaseExpiresAt;
    const run = await tx.automationRun.create({
      data: {
        id: runId,
        automationEventId: event.id,
        workflowName: input.workflowName,
        workerId: input.workerId,
        claimRequestId: input.requestId,
        idempotencyKey: automationRunIdempotencyKey(event.id, attemptNumber),
        attemptNumber,
        startedAt: now,
      },
    });

    await tx.automationEvent.update({
      where: { id: event.id },
      data: {
        status: AutomationEventStatus.PROCESSING,
        attemptCount: attemptNumber,
        availableAt: leaseExpiresAt,
        currentRunId: run.id,
        claimedBy: input.workerId,
        claimedAt: now,
        leaseExpiresAt,
      },
    });

    const invalidCode = envelopeError(event);
    if (invalidCode) {
      await terminalizeRun(tx, {
        runId: run.id,
        status: AutomationRunStatus.FAILED,
        errorCode: invalidCode,
        errorMessage: "The event envelope is unsupported or invalid.",
        classification: AutomationFailureClassification.PERMANENT,
      });
      await tx.automationEvent.update({
        where: { id: event.id },
        data: {
          status: AutomationEventStatus.DEAD_LETTER,
          currentRunId: null,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          lastErrorCode: invalidCode,
          lastError: "The event envelope is unsupported or invalid.",
        },
      });
      await tx.automationClaimRequest.update({
        where: { requestId: input.requestId },
        data: {
          outcome: AutomationClaimOutcome.REJECTED,
          automationEventId: event.id,
          errorCode: invalidCode,
        },
      });
      return { kind: "REJECTED", code: invalidCode };
    }

    await tx.automationClaimRequest.update({
      where: { requestId: input.requestId },
      data: {
        outcome: AutomationClaimOutcome.CLAIMED,
        automationEventId: event.id,
      },
    });

    return {
      kind: "CLAIMED",
      idempotent: false,
      event: toAutomationEventEnvelope(event),
      run: {
        runId: run.id,
        workerId: run.workerId,
        workflowName: run.workflowName,
        idempotencyKey: run.idempotencyKey,
        attemptNumber: run.attemptNumber,
        startedAt: run.startedAt.toISOString(),
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      },
    };
  });
}

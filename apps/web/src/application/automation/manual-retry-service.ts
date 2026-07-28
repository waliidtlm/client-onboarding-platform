import {
  AuditActorType,
  AutomationEventStatus,
  AutomationFailureClassification,
  Prisma,
  Role,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";

import { manualRetryAutomationSchema } from "@/application/automation/contracts";
import { appendAuditEvent } from "@/application/commercial/audit";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
} from "@/application/commercial/service-support";
import {
  isSupportedAutomationEnvelope,
  onboardingActivatedDeduplicationKey,
} from "@/domain/automation/idempotency";
import type { Result } from "@/domain/errors";

export type ManualRetryResult = Readonly<{
  eventId: string;
  status: AutomationEventStatus;
  maxAttempts: number;
}>;

export async function retryAutomationEvent(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<ManualRetryResult>> {
  return executeService(async () => {
    const input = parseInput(manualRetryAutomationSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN]);
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "AutomationEvent"
          WHERE "id" = ${input.eventId}::uuid
          FOR UPDATE
        `);
        const event = await tx.automationEvent.findUnique({
          where: { id: input.eventId },
          include: {
            onboarding: { include: { client: true } },
            runs: { orderBy: { attemptNumber: "desc" }, take: 1 },
          },
        });
        if (!event) reject("NOT_FOUND", "The automation event does not exist.");
        if (
          event.status !== AutomationEventStatus.FAILED &&
          event.status !== AutomationEventStatus.DEAD_LETTER
        ) {
          reject("INVALID_TRANSITION", "Only failed or dead-letter events can be retried.");
        }
        if (event.eventType === "WELCOME_EMAIL_REQUESTED") {
          const payload = event.payload as { notificationId?: string };
          const notification = payload.notificationId
            ? await tx.notificationLog.findUnique({ where: { id: payload.notificationId } })
            : null;
          if (notification?.status === "DELIVERY_UNCERTAIN") {
            reject(
              "EMAIL_DELIVERY_UNCERTAIN",
              "Resolve the uncertain delivery before authorizing another email attempt.",
            );
          }
        }
        if (event.eventType !== "ONBOARDING_ACTIVATED") {
          reject(
            "INVALID_TRANSITION",
            "Use the event-specific Phase 4 recovery action for this event.",
          );
        }
        if (event.currentRunId || event.claimedBy || event.leaseExpiresAt) {
          reject("AUTOMATION_EVENT_CONFLICT", "The event still has an active run.");
        }
        if (!isSupportedAutomationEnvelope(event)) {
          reject("INVALID_EVENT_SCHEMA", "Malformed or unsupported events cannot be retried.");
        }
        if (
          event.deduplicationKey !== onboardingActivatedDeduplicationKey(event.aggregateId) ||
          event.payload === null ||
          typeof event.payload !== "object" ||
          Array.isArray(event.payload) ||
          Object.keys(event.payload as object).length !== 0
        ) {
          reject("INVALID_EVENT_INTEGRITY", "The event integrity check failed.");
        }
        const onboarding = event.onboarding;
        if (onboarding.status !== "READY_FOR_ONBOARDING" || !onboarding.activatedAt) {
          reject("INVALID_TRANSITION", "The onboarding is no longer eligible.");
        }
        if (!onboarding.client || !onboarding.servicePackageNameSnapshot) {
          reject(
            "MISSING_BUSINESS_CONFIGURATION",
            "Required onboarding configuration remains missing.",
          );
        }
        const lastRun = event.runs[0];
        const recoverable =
          event.status === AutomationEventStatus.FAILED
            ? lastRun?.failureClassification === AutomationFailureClassification.OPERATOR_REMEDIABLE
            : lastRun?.failureClassification === AutomationFailureClassification.RETRYABLE ||
              lastRun?.status === "TIMED_OUT" ||
              event.lastErrorCode === "ATTEMPTS_EXHAUSTED";
        if (!recoverable) {
          reject("INVALID_TRANSITION", "This failure is not operationally retryable.");
        }
        const nowRows = await tx.$queryRaw<Array<{ now: Date }>>(
          Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
        );
        const maxAttempts = Math.max(event.maxAttempts, event.attemptCount + 1);
        await tx.automationEvent.update({
          where: { id: event.id },
          data: {
            status: AutomationEventStatus.PENDING,
            availableAt: nowRows[0]!.now,
            maxAttempts,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "AUTOMATION_EVENT_MANUAL_RETRY_REQUESTED",
          entityType: "AUTOMATION_EVENT",
          entityId: event.id,
          previousValue: {
            status: event.status,
            maxAttempts: event.maxAttempts,
            lastErrorCode: event.lastErrorCode,
          },
          newValue: {
            status: AutomationEventStatus.PENDING,
            maxAttempts,
          },
          metadata: { reason: input.reason },
          correlationId: input.correlationId,
        });
        return {
          eventId: event.id,
          status: AutomationEventStatus.PENDING,
          maxAttempts,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

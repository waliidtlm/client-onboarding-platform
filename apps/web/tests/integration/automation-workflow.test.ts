import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ActivationRequirementStatus,
  ActivationType,
  AutomationEventStatus,
  AutomationFailureClassification,
  AutomationRunStatus,
  CommercialGateStatus,
  ContractStatus,
  DealStatus,
  InvoiceStatus,
  OnboardingStatus,
  PaymentVerificationStatus,
  PrismaClient,
} from "../../src/generated/prisma/client";
import { completeAutomationRun } from "../../src/application/automation/callback-service";
import { claimAutomationEvent } from "../../src/application/automation/claim-service";
import { loadAutomationContext } from "../../src/application/automation/context-service";
import { failAutomationRun } from "../../src/application/automation/failure-service";
import { retryAutomationEvent } from "../../src/application/automation/manual-retry-service";
import type {
  AutomationClaimResult,
  AutomationRunClaim,
} from "../../src/application/automation/types";
import { activateOnboarding } from "../../src/application/commercial/commercial-gate-service";
import type { Result } from "../../src/domain/errors";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
if (!runtimeUrl || !migrationUrl) throw new Error("Test database URLs are required");

const runtimeRole = decodeURIComponent(new URL(runtimeUrl).username);
if (!/^[a-z_][a-z0-9_]*$/.test(runtimeRole)) {
  throw new Error("TEST_DATABASE_URL must contain a safe PostgreSQL role");
}
const quotedRuntimeRole = `"${runtimeRole}"`;

const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }) });
const migration = new PrismaClient({ adapter: new PrismaPg({ connectionString: migrationUrl }) });

let salesId = "";
let financeId = "";
let adminId = "";
const PHASE4_CAPABILITIES = [
  "ONBOARDING_ACTIVATED",
  "PROVISIONING_TASK_REQUESTED",
  "WELCOME_EMAIL_REQUESTED",
] as const;

function valueOf<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function claimed(
  result: Result<AutomationClaimResult>,
): Extract<AutomationClaimResult, { kind: "CLAIMED" }> {
  const value = valueOf(result);
  expect(value.kind).toBe("CLAIMED");
  if (value.kind !== "CLAIMED") throw new Error("Expected a claimed automation event");
  return value;
}

async function createEligibleOnboarding(label: string): Promise<{
  id: string;
  version: number;
}> {
  const existing = await runtime.onboarding.findFirstOrThrow();
  const onboarding = await runtime.onboarding.create({
    data: {
      clientId: existing.clientId,
      servicePackageId: existing.servicePackageId,
      externalDealId: `${label}-${randomUUID()}`,
      dealStatus: DealStatus.CLOSED_WON,
      salesHandoffStatus: "COMPLETE",
      commercialGateStatus: CommercialGateStatus.BLOCKED,
      status: OnboardingStatus.COMMERCIAL_PENDING,
      submittedById: salesId,
      invoiceTotal: "1.0000",
      currency: "USD",
      servicePackageNameSnapshot: "Phase 3 integration package",
      activationTypeSnapshot: ActivationType.FULL_PAYMENT_PERCENTAGE,
      activationValueSnapshot: "100.0000",
      activationRequiredAmount: "1.0000",
      activationRequirementStatus: ActivationRequirementStatus.SATISFIED,
      contracts: {
        create: {
          status: ContractStatus.SIGNED,
          versionNumber: 1,
          signedAt: new Date(),
        },
      },
    },
  });
  const invoice = await runtime.invoice.create({
    data: {
      onboardingId: onboarding.id,
      status: InvoiceStatus.ISSUED,
      invoiceNumber: `${label}-${randomUUID()}`,
      totalAmount: "1.0000",
      currency: "USD",
      dueAt: new Date("2026-12-01T23:59:59.000Z"),
    },
  });
  await runtime.payment.create({
    data: {
      invoiceId: invoice.id,
      originalAmount: "1.0000",
      verifiedAmount: "1.0000",
      currency: "USD",
      verificationStatus: PaymentVerificationStatus.VERIFIED,
      submittedById: financeId,
      verifiedById: financeId,
      verifiedAt: new Date(),
      recordingKey: randomUUID(),
    },
  });
  await runtime.onboarding.update({
    where: { id: onboarding.id },
    data: { activationInvoiceId: invoice.id },
  });
  return onboarding;
}

async function activateFixture(label: string): Promise<{
  onboardingId: string;
  eventId: string;
}> {
  const onboarding = await createEligibleOnboarding(label);
  const activation = valueOf(
    await activateOnboarding(
      {
        actorId: adminId,
        onboardingId: onboarding.id,
        expectedVersion: onboarding.version,
        correlationId: randomUUID(),
      },
      runtime,
    ),
  );
  if (!activation.automationEvent) throw new Error("Activation did not append an event");
  return {
    onboardingId: onboarding.id,
    eventId: activation.automationEvent.eventId,
  };
}

async function isolateClaimCandidate(eventId: string): Promise<void> {
  await runtime.automationEvent.updateMany({
    where: {
      id: { not: eventId },
      status: AutomationEventStatus.PENDING,
    },
    data: { availableAt: new Date("2099-01-01T00:00:00.000Z") },
  });
}

async function claimEvent(
  eventId: string,
  workerId = "integration-worker",
  workflowName = "phase3-integration",
): Promise<Extract<AutomationClaimResult, { kind: "CLAIMED" }>> {
  await isolateClaimCandidate(eventId);
  return claimed(
    await claimAutomationEvent(
      {
        requestId: randomUUID(),
        workerId,
        workflowName,
        supportedEventTypes: PHASE4_CAPABILITIES,
      },
      runtime,
    ),
  );
}

function callbackFor(
  eventId: string,
  run: AutomationRunClaim,
  executionId = `exec-${randomUUID()}`,
) {
  return {
    eventId,
    runId: run.runId,
    idempotencyKey: run.idempotencyKey,
    workerId: run.workerId,
    n8nExecutionId: executionId,
    resultStatus: "COMPLETED" as const,
    externalReferences: { project: "project-123", task: "task-456" },
  };
}

beforeAll(async () => {
  const [sales, finance, admin] = await Promise.all([
    runtime.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    runtime.user.findUniqueOrThrow({ where: { email: "finance@northstar.test" } }),
    runtime.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
  ]);
  salesId = sales.id;
  financeId = finance.id;
  adminId = admin.id;
});

afterAll(async () => Promise.all([runtime.$disconnect(), migration.$disconnect()]));

describe("Phase 3 durable automation processing", () => {
  it("commits activation, audit, and one deduplicated event atomically", async () => {
    const onboarding = await createEligibleOnboarding("AUTOMATION-ATOMIC");
    await migration.$executeRawUnsafe(
      `REVOKE INSERT ON TABLE "AutomationEvent" FROM ${quotedRuntimeRole}`,
    );
    try {
      await expect(
        activateOnboarding(
          {
            actorId: adminId,
            onboardingId: onboarding.id,
            expectedVersion: onboarding.version,
            correlationId: randomUUID(),
          },
          runtime,
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await migration.$executeRawUnsafe(
        `GRANT INSERT ON TABLE "AutomationEvent" TO ${quotedRuntimeRole}`,
      );
    }

    const rolledBack = await runtime.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
    });
    expect(rolledBack.status).toBe(OnboardingStatus.COMMERCIAL_PENDING);
    expect(
      await runtime.auditEvent.count({
        where: { onboardingId: onboarding.id, action: "ONBOARDING_ACTIVATED" },
      }),
    ).toBe(0);

    const input = {
      actorId: adminId,
      onboardingId: onboarding.id,
      expectedVersion: onboarding.version,
      correlationId: randomUUID(),
    };
    const first = valueOf(await activateOnboarding(input, runtime));
    const second = valueOf(await activateOnboarding(input, runtime));
    expect(first.automationEvent?.eventId).toBeDefined();
    expect(second.automationEvent?.eventId).toBe(first.automationEvent?.eventId);
    expect(second.idempotent).toBe(true);
    expect(await runtime.automationEvent.count({ where: { aggregateId: onboarding.id } })).toBe(1);
  });

  it("claims concurrently with retained request replay and event-bound context", async () => {
    const fixture = await activateFixture("AUTOMATION-CLAIM");
    await isolateClaimCandidate(fixture.eventId);
    const requestId = randomUUID();
    const input = {
      requestId,
      workerId: "worker-claim",
      workflowName: "phase3-consumer",
      supportedEventTypes: PHASE4_CAPABILITIES,
    };
    const [left, right] = await Promise.all([
      claimAutomationEvent(input, runtime),
      claimAutomationEvent({ ...input, requestId: randomUUID() }, runtime),
    ]);
    const results = [valueOf(left), valueOf(right)];
    expect(results.filter((result) => result.kind === "CLAIMED")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "EMPTY")).toHaveLength(1);

    const active = results.find(
      (result): result is Extract<AutomationClaimResult, { kind: "CLAIMED" }> =>
        result.kind === "CLAIMED",
    )!;
    expect(active.event.eventId).toBe(fixture.eventId);
    const replayRequestId =
      active.run.workflowName === input.workflowName &&
      (await runtime.automationRun.findUniqueOrThrow({ where: { id: active.run.runId } }))
        .claimRequestId;
    const replay = claimed(
      await claimAutomationEvent({ ...input, requestId: replayRequestId }, runtime),
    );
    expect(replay.idempotent).toBe(true);
    expect(replay.run).toEqual(active.run);

    const conflict = await claimAutomationEvent(
      { ...input, requestId: replayRequestId, workerId: "different-worker" },
      runtime,
    );
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "CLAIM_REQUEST_CONFLICT" },
    });
    const capabilityConflict = await claimAutomationEvent(
      {
        ...input,
        requestId: replayRequestId,
        supportedEventTypes: ["ONBOARDING_ACTIVATED"],
      },
      runtime,
    );
    expect(capabilityConflict).toMatchObject({
      ok: false,
      error: { code: "CLAIM_REQUEST_CONFLICT" },
    });

    const context = valueOf(
      await loadAutomationContext(
        fixture.eventId,
        {
          runId: active.run.runId,
          idempotencyKey: active.run.idempotencyKey,
          workerId: active.run.workerId,
        },
        runtime,
      ),
    );
    expect(context.onboarding.id).toBe(fixture.onboardingId);
    expect(context.onboarding.clientCompanyName).toBeTruthy();
    const unrelated = await loadAutomationContext(
      fixture.eventId,
      {
        runId: randomUUID(),
        idempotencyKey: active.run.idempotencyKey,
        workerId: active.run.workerId,
      },
      runtime,
    );
    expect(unrelated).toMatchObject({
      ok: false,
      error: { code: "AUTOMATION_CONTEXT_DENIED" },
    });
  });

  it("rejects capabilities outside the authenticated worker allowlist", async () => {
    const broadened = await claimAutomationEvent(
      {
        requestId: randomUUID(),
        workerId: "phase5-access-worker",
        workflowName: "Phase 5 Access Email",
        supportedEventTypes: ["CLIENT_ACCESS_EMAIL_REQUESTED", "ONBOARDING_ACTIVATED"],
      },
      runtime,
      ["CLIENT_ACCESS_EMAIL_REQUESTED"],
    );
    expect(broadened).toMatchObject({
      ok: false,
      error: { code: "ACCESS_DENIED" },
    });

    const completionEvent = await claimAutomationEvent(
      {
        requestId: randomUUID(),
        workerId: "phase5-access-worker",
        workflowName: "Phase 5 Access Email",
        supportedEventTypes: ["CLIENT_REQUIREMENTS_COMPLETED"],
      },
      runtime,
      ["CLIENT_ACCESS_EMAIL_REQUESTED"],
    );
    expect(completionEvent).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("normalizes callback replay and enforces terminal run immutability in PostgreSQL", async () => {
    const fixture = await activateFixture("AUTOMATION-CALLBACK");
    const active = await claimEvent(fixture.eventId, "worker-callback");
    const callback = callbackFor(fixture.eventId, active.run);
    const first = valueOf(await completeAutomationRun(callback, runtime));
    expect(first).toMatchObject({
      status: AutomationEventStatus.COMPLETED,
      idempotent: false,
    });
    const replay = valueOf(
      await completeAutomationRun(
        {
          ...callback,
          externalReferences: { task: "task-456", project: "project-123" },
        },
        runtime,
      ),
    );
    expect(replay.idempotent).toBe(true);
    await expect(
      completeAutomationRun(
        {
          ...callback,
          externalReferences: { project: "different" },
        },
        runtime,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTOMATION_RUN_CONFLICT" },
    });

    await expect(
      runtime.automationRun.update({
        where: { id: active.run.runId },
        data: { resultReferences: { mutated: true } },
      }),
    ).rejects.toThrow(/immutable/i);
    await expect(runtime.automationRun.delete({ where: { id: active.run.runId } })).rejects.toThrow(
      /cannot be deleted/i,
    );
  });

  it("applies retry, dead-letter, stale-run, and one-extra-attempt semantics", async () => {
    const fixture = await activateFixture("AUTOMATION-FAILURE");
    await runtime.automationEvent.update({
      where: { id: fixture.eventId },
      data: { maxAttempts: 2 },
    });
    const first = await claimEvent(fixture.eventId, "worker-failure");
    const firstFailure = {
      eventId: fixture.eventId,
      runId: first.run.runId,
      idempotencyKey: first.run.idempotencyKey,
      workerId: first.run.workerId,
      n8nExecutionId: `exec-${randomUUID()}`,
      failedNode: "Contract validation",
      errorCode: "NETWORK_TIMEOUT",
      errorMessage: "Provider timeout token=must-not-survive",
      classification: AutomationFailureClassification.RETRYABLE,
    };
    const retryable = valueOf(await failAutomationRun(firstFailure, runtime));
    expect(retryable.status).toBe(AutomationEventStatus.PENDING);
    const failureReplay = valueOf(await failAutomationRun(firstFailure, runtime));
    expect(failureReplay.idempotent).toBe(true);
    const firstStored = await runtime.automationRun.findUniqueOrThrow({
      where: { id: first.run.runId },
    });
    expect(firstStored.errorMessage).not.toContain("must-not-survive");

    await runtime.automationEvent.update({
      where: { id: fixture.eventId },
      data: { availableAt: new Date("2000-01-01T00:00:00.000Z") },
    });
    const second = await claimEvent(fixture.eventId, "worker-failure");
    const exhausted = valueOf(
      await failAutomationRun(
        {
          ...firstFailure,
          runId: second.run.runId,
          idempotencyKey: second.run.idempotencyKey,
          n8nExecutionId: `exec-${randomUUID()}`,
        },
        runtime,
      ),
    );
    expect(exhausted.status).toBe(AutomationEventStatus.DEAD_LETTER);

    const manual = valueOf(
      await retryAutomationEvent(
        {
          actorId: adminId,
          eventId: fixture.eventId,
          reason: "Provider recovered; authorize exactly one additional attempt.",
          correlationId: randomUUID(),
        },
        runtime,
      ),
    );
    expect(manual).toMatchObject({
      status: AutomationEventStatus.PENDING,
      maxAttempts: 3,
    });
    const third = await claimEvent(fixture.eventId, "worker-failure");
    await runtime.automationEvent.update({
      where: { id: fixture.eventId },
      data: {
        availableAt: new Date("2000-01-01T00:00:00.000Z"),
        leaseExpiresAt: new Date("2000-01-01T00:00:00.000Z"),
      },
    });
    const recoveryClaim = valueOf(
      await claimAutomationEvent(
        {
          requestId: randomUUID(),
          workerId: "recovery-worker",
          workflowName: "phase3-consumer",
          supportedEventTypes: PHASE4_CAPABILITIES,
        },
        runtime,
      ),
    );
    expect(recoveryClaim.kind).toBe("EMPTY");
    const timedOut = await runtime.automationRun.findUniqueOrThrow({
      where: { id: third.run.runId },
    });
    expect(timedOut.status).toBe(AutomationRunStatus.TIMED_OUT);
    expect(
      (await runtime.automationEvent.findUniqueOrThrow({ where: { id: fixture.eventId } })).status,
    ).toBe(AutomationEventStatus.DEAD_LETTER);
    await expect(
      completeAutomationRun(callbackFor(fixture.eventId, third.run), runtime),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTOMATION_RUN_CONFLICT" },
    });

    const secondManual = valueOf(
      await retryAutomationEvent(
        {
          actorId: adminId,
          eventId: fixture.eventId,
          reason: "Lease failure reviewed; authorize the one recovery attempt.",
          correlationId: randomUUID(),
        },
        runtime,
      ),
    );
    expect(secondManual.maxAttempts).toBe(4);
  });

  it("marks operator-remediable failures FAILED and invalid schemas permanently dead", async () => {
    const operatorFixture = await activateFixture("AUTOMATION-OPERATOR");
    const operatorRun = await claimEvent(operatorFixture.eventId, "worker-operator");
    const operatorFailure = valueOf(
      await failAutomationRun(
        {
          eventId: operatorFixture.eventId,
          runId: operatorRun.run.runId,
          idempotencyKey: operatorRun.run.idempotencyKey,
          workerId: operatorRun.run.workerId,
          n8nExecutionId: `exec-${randomUUID()}`,
          failedNode: "Configuration check",
          errorCode: "MISSING_BUSINESS_CONFIGURATION",
          errorMessage: "A required routing value is absent.",
          classification: AutomationFailureClassification.OPERATOR_REMEDIABLE,
        },
        runtime,
      ),
    );
    expect(operatorFailure.status).toBe(AutomationEventStatus.FAILED);

    const invalidFixture = await activateFixture("AUTOMATION-SCHEMA");
    await runtime.automationEvent.update({
      where: { id: invalidFixture.eventId },
      data: { schemaVersion: 2 },
    });
    await isolateClaimCandidate(invalidFixture.eventId);
    const invalid = await claimAutomationEvent(
      {
        requestId: randomUUID(),
        workerId: "worker-schema",
        workflowName: "phase3-consumer",
        supportedEventTypes: PHASE4_CAPABILITIES,
      },
      runtime,
    );
    expect(invalid).toMatchObject({
      ok: false,
      error: { code: "INVALID_EVENT_SCHEMA" },
    });
    expect(
      (
        await runtime.automationEvent.findUniqueOrThrow({
          where: { id: invalidFixture.eventId },
        })
      ).status,
    ).toBe(AutomationEventStatus.DEAD_LETTER);
  });
});

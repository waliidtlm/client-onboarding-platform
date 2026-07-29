import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AutomationEventStatus,
  AutomationRunStatus,
  NotificationStatus,
  OnboardingStatus,
  PrismaClient,
  ProvisioningTaskAttemptStatus,
  ProvisioningTaskStatus,
} from "../../src/generated/prisma/client";
import { claimAutomationEvent } from "../../src/application/automation/claim-service";
import { failAutomationRun } from "../../src/application/automation/failure-service";
import { retryAutomationEvent } from "../../src/application/automation/manual-retry-service";
import {
  approveInternalReadiness,
  beginWelcomeEmailDelivery,
  recordWelcomeEmailResult,
  resolveWelcomeDeliveryUncertainty,
} from "../../src/application/notifications/welcome-email-service";
import { acceptManualProvisioning } from "../../src/application/provisioning/manual-review-service";
import { executeSandboxProvisioningTask } from "../../src/application/provisioning/sandbox-execution-service";
import { generatePackageTasks } from "../../src/application/provisioning/task-generation-service";
import {
  completeProvisioningTask,
  failProvisioningTask,
  startProvisioningTask,
} from "../../src/application/provisioning/task-lifecycle-service";
import type {
  AutomationClaimResult,
  AutomationRunClaim,
} from "../../src/application/automation/types";
import { onboardingActivatedDeduplicationKey } from "../../src/domain/automation/idempotency";
import type { Result } from "../../src/domain/errors";

const runtimeUrl = process.env.TEST_DATABASE_URL;
if (!runtimeUrl) throw new Error("TEST_DATABASE_URL is required");
const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }) });

let adminId = "";
let projectManagerId = "";
let salesId = "";
let baseClientId = "";
let basePackageId = "";

function valueOf<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function claimed(
  result: Result<AutomationClaimResult>,
): Extract<AutomationClaimResult, { kind: "CLAIMED" }> {
  const value = valueOf(result);
  if (value.kind !== "CLAIMED") throw new Error(`Expected claim, received ${value.kind}`);
  return value;
}

async function claimSpecific(
  eventId: string,
  workerId = `phase4-worker-${randomUUID()}`,
): Promise<Extract<AutomationClaimResult, { kind: "CLAIMED" }>> {
  await runtime.automationEvent.updateMany({
    where: { id: { not: eventId }, status: AutomationEventStatus.PENDING },
    data: { availableAt: new Date("2099-01-01T00:00:00.000Z") },
  });
  await runtime.automationEvent.update({
    where: { id: eventId },
    data: { availableAt: new Date("2020-01-01T00:00:00.000Z") },
  });
  return claimed(
    await claimAutomationEvent(
      {
        requestId: randomUUID(),
        workerId,
        workflowName: "Phase 4 Integration Consumer",
        supportedEventTypes: [
          "ONBOARDING_ACTIVATED",
          "PROVISIONING_TASK_REQUESTED",
          "WELCOME_EMAIL_REQUESTED",
        ],
      },
      runtime,
    ),
  );
}

function machine(eventId: string, run: AutomationRunClaim) {
  return {
    eventId,
    runId: run.runId,
    idempotencyKey: run.idempotencyKey,
    workerId: run.workerId,
    n8nExecutionId: `execution-${randomUUID()}`,
  };
}

async function createReadyFixture(label: string, options: { manualReviewDemo?: boolean } = {}) {
  let servicePackageId = basePackageId;
  if (options.manualReviewDemo) {
    const servicePackage = await runtime.servicePackage.create({
      data: {
        name: `${label}-${randomUUID()}`,
        description: "Isolated Phase 4 manual-review integration package.",
        isActive: true,
        activationType: "MANUAL_APPROVAL",
        activationValue: "0.0000",
        provisioningTemplates: {
          create: {
            name: "Manual review demo task",
            description: "Local sandbox resource permanent-failure scenario.",
            sequence: 1,
            isRequired: true,
            automationKey: "MANUAL_REVIEW_DEMO",
          },
        },
      },
    });
    servicePackageId = servicePackage.id;
  }
  const onboarding = await runtime.onboarding.create({
    data: {
      clientId: baseClientId,
      servicePackageId,
      externalDealId: `${label}-${randomUUID()}`,
      dealStatus: "CLOSED_WON",
      salesHandoffStatus: "COMPLETE",
      commercialGateStatus: "APPROVED",
      commercialGateEvaluatedAt: new Date(),
      status: OnboardingStatus.READY_FOR_ONBOARDING,
      projectManagerId,
      submittedById: salesId,
      validatedById: adminId,
      invoiceTotal: "100.0000",
      currency: "USD",
      servicePackageNameSnapshot: `${label} package`,
      activationTypeSnapshot: options.manualReviewDemo ? "MANUAL_APPROVAL" : "DEPOSIT_PERCENTAGE",
      activationValueSnapshot: options.manualReviewDemo ? "0.0000" : "30.0000",
      activationRequiredAmount: options.manualReviewDemo ? null : "30.0000",
      activationRequirementStatus: "SATISFIED",
      activatedAt: new Date(),
    },
  });
  const event = await runtime.automationEvent.create({
    data: {
      eventType: "ONBOARDING_ACTIVATED",
      aggregateType: "ONBOARDING",
      aggregateId: onboarding.id,
      payload: {},
      schemaVersion: 1,
      maxAttempts: 5,
      availableAt: new Date(),
      occurredAt: new Date(),
      correlationId: randomUUID(),
      deduplicationKey: onboardingActivatedDeduplicationKey(onboarding.id),
    },
  });
  const activationClaim = await claimSpecific(event.id);
  valueOf(
    await generatePackageTasks(
      {
        ...machine(event.id, activationClaim.run),
      },
      runtime,
    ),
  );
  return runtime.onboarding.findUniqueOrThrow({
    where: { id: onboarding.id },
    include: {
      provisioningTasks: { orderBy: { sequence: "asc" } },
    },
  });
}

async function processTask(eventId: string) {
  const claim = await claimSpecific(eventId);
  const payload = claim.event.payload as { taskId: string };
  const task = await runtime.provisioningTask.findUniqueOrThrow({ where: { id: payload.taskId } });
  const call = machine(eventId, claim.run);
  const start = valueOf(
    await startProvisioningTask(
      { ...call, taskId: task.id, expectedTaskVersion: task.version },
      runtime,
    ),
  );
  if (start.instruction !== "EXECUTE" || !start.attemptId || !start.attemptNumber) {
    throw new Error(`Unexpected task instruction ${start.instruction}`);
  }
  const provider = valueOf(
    await executeSandboxProvisioningTask(
      {
        ...call,
        taskId: task.id,
        expectedTaskVersion: start.taskVersion,
        attemptId: start.attemptId,
        attemptNumber: start.attemptNumber,
      },
      runtime,
    ),
  );
  if (provider.kind === "COMPLETED") {
    const result = valueOf(
      await completeProvisioningTask(
        {
          ...call,
          taskId: task.id,
          expectedTaskVersion: start.taskVersion,
          attemptId: start.attemptId,
          attemptNumber: start.attemptNumber,
          externalReference: provider.externalReference,
        },
        runtime,
      ),
    );
    return { provider, result, call, start };
  }
  const result = valueOf(
    await failProvisioningTask(
      {
        ...call,
        taskId: task.id,
        expectedTaskVersion: start.taskVersion,
        attemptId: start.attemptId,
        attemptNumber: start.attemptNumber,
        errorCode: provider.errorCode,
        errorMessage: provider.errorMessage,
        retryable: provider.retryable,
      },
      runtime,
    ),
  );
  return { provider, result, call, start };
}

beforeAll(async () => {
  const [admin, projectManager, sales, client, servicePackage] = await Promise.all([
    runtime.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
    runtime.user.findUniqueOrThrow({ where: { email: "pm@northstar.test" } }),
    runtime.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    runtime.client.findUniqueOrThrow({ where: { companyName: "Atlas Fitness Studio" } }),
    runtime.servicePackage.findUniqueOrThrow({ where: { name: "Paid Growth Launch" } }),
  ]);
  adminId = admin.id;
  projectManagerId = projectManager.id;
  salesId = sales.id;
  baseClientId = client.id;
  basePackageId = servicePackage.id;
});

afterAll(async () => runtime.$disconnect());

describe("Phase 4 provisioning and readiness", () => {
  it("separates transport attempts from provider attempts and reuses one task event", async () => {
    const onboarding = await createReadyFixture("PHASE4-ATTEMPTS");
    const firstTask = onboarding.provisioningTasks[0]!;
    const firstEvent = await runtime.automationEvent.findFirstOrThrow({
      where: {
        eventType: "PROVISIONING_TASK_REQUESTED",
        payload: { path: ["taskId"], equals: firstTask.id },
      },
    });

    const transportClaim = await claimSpecific(firstEvent.id);
    valueOf(
      await failAutomationRun(
        {
          ...machine(firstEvent.id, transportClaim.run),
          failedNode: "Before task start",
          errorCode: "TEMPORARY_PROVIDER_FAILURE",
          errorMessage: "Transport failed before reserving provider work.",
          classification: "RETRYABLE",
          reportedAt: new Date().toISOString(),
        },
        runtime,
      ),
    );
    expect(
      await runtime.provisioningTaskAttempt.count({
        where: { provisioningTaskId: firstTask.id },
      }),
    ).toBe(0);

    const firstResult = await processTask(firstEvent.id);
    expect(firstResult.provider.kind).toBe("COMPLETED");
    const taskAfterStart = await runtime.provisioningTask.findUniqueOrThrow({
      where: { id: firstTask.id },
    });
    expect(taskAfterStart.attemptCount).toBe(1);
    expect(
      await runtime.automationEvent.findUniqueOrThrow({ where: { id: firstEvent.id } }),
    ).toMatchObject({ attemptCount: 2, status: AutomationEventStatus.COMPLETED });

    let nextEventId = firstResult.result.nextTaskEventId;
    if (!nextEventId) throw new Error("Expected second task event");
    const secondFailure = await processTask(nextEventId);
    expect(secondFailure.provider.kind).toBe("FAILED");
    const secondEventId = nextEventId;
    const secondRetry = await processTask(secondEventId);
    expect(secondRetry.provider.kind).toBe("COMPLETED");
    const secondTaskId = (
      await runtime.automationEvent.findUniqueOrThrow({ where: { id: secondEventId } })
    ).payload as { taskId: string };
    expect(
      await runtime.provisioningTaskAttempt.count({
        where: { provisioningTaskId: secondTaskId.taskId },
      }),
    ).toBe(2);
    expect(
      await runtime.automationEvent.count({
        where: {
          eventType: "PROVISIONING_TASK_REQUESTED",
          payload: { path: ["taskId"], equals: secondTaskId.taskId },
        },
      }),
    ).toBe(1);

    nextEventId = secondRetry.result.nextTaskEventId;
    while (nextEventId) {
      const completed = await processTask(nextEventId);
      nextEventId = completed.result.nextTaskEventId;
    }
    expect(
      (await runtime.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } })).status,
    ).toBe(OnboardingStatus.INTERNAL_REVIEW);
    expect(
      await runtime.sandboxProvisionedResource.count({
        where: { provisioningTask: { onboardingId: onboarding.id } },
      }),
    ).toBe(4);
  });

  it("keeps the event failed during manual review and resolves it without a fake successful run", async () => {
    const onboarding = await createReadyFixture("PHASE4-MANUAL", {
      manualReviewDemo: true,
    });
    const task = onboarding.provisioningTasks[0]!;
    const event = await runtime.automationEvent.findFirstOrThrow({
      where: {
        eventType: "PROVISIONING_TASK_REQUESTED",
        payload: { path: ["taskId"], equals: task.id },
      },
    });
    const failure = await processTask(event.id);
    expect(failure.provider.kind).toBe("FAILED");
    expect(failure.result).toMatchObject({
      taskStatus: ProvisioningTaskStatus.MANUAL_REVIEW_REQUIRED,
      eventStatus: AutomationEventStatus.FAILED,
    });

    const accepted = valueOf(
      await acceptManualProvisioning(
        {
          actorId: projectManagerId,
          onboardingId: onboarding.id,
          taskId: task.id,
          expectedTaskVersion: failure.result.taskVersion,
          reason: "Verified the isolated local sandbox result outside automation.",
          correlationId: randomUUID(),
        },
        runtime,
      ),
    );
    expect(accepted.taskStatus).toBe(ProvisioningTaskStatus.MANUALLY_ACCEPTED);
    const [resolvedEvent, preservedRun] = await Promise.all([
      runtime.automationEvent.findUniqueOrThrow({ where: { id: event.id } }),
      runtime.automationRun.findUniqueOrThrow({ where: { id: failure.call.runId } }),
    ]);
    expect(resolvedEvent).toMatchObject({
      status: AutomationEventStatus.COMPLETED,
      resolutionCode: "MANUALLY_ACCEPTED",
      resolvedById: projectManagerId,
    });
    expect(preservedRun.status).toBe(AutomationRunStatus.FAILED);
  });

  it("freezes delivery data and requires Admin resolution for SMTP ambiguity", async () => {
    const onboarding = await createReadyFixture("PHASE4-WELCOME");
    let nextEventId = await runtime.automationEvent
      .findFirstOrThrow({
        where: {
          eventType: "PROVISIONING_TASK_REQUESTED",
          aggregateId: onboarding.id,
          status: AutomationEventStatus.PENDING,
        },
      })
      .then((event) => event.id);
    while (nextEventId) {
      const completed = await processTask(nextEventId);
      nextEventId =
        completed.result.taskStatus === ProvisioningTaskStatus.PENDING
          ? nextEventId
          : (completed.result.nextTaskEventId ?? "");
    }
    const review = await runtime.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } });
    expect(review.status).toBe(OnboardingStatus.INTERNAL_REVIEW);
    const approval = valueOf(
      await approveInternalReadiness(
        {
          actorId: projectManagerId,
          onboardingId: onboarding.id,
          expectedVersion: review.version,
          note: "Integration readiness approval.",
          correlationId: randomUUID(),
        },
        runtime,
      ),
    );
    const frozen = await runtime.notificationLog.findUniqueOrThrow({
      where: { id: approval.notificationId },
    });
    await runtime.client.update({
      where: { id: baseClientId },
      data: { contactEmail: `changed-${randomUUID()}@northstar.test` },
    });

    const claim = await claimSpecific(approval.eventId);
    const call = machine(approval.eventId, claim.run);
    const begun = valueOf(
      await beginWelcomeEmailDelivery(
        { ...call, notificationId: approval.notificationId },
        runtime,
      ),
    );
    expect(begun.recipient).toBe(frozen.recipient);
    expect(begun.textContent).toBe(frozen.textContent);
    valueOf(
      await recordWelcomeEmailResult(
        {
          ...call,
          notificationId: approval.notificationId,
          outcome: "DELIVERY_UNCERTAIN",
          providerReference: null,
          errorCode: "EMAIL_DELIVERY_UNCERTAIN",
          errorMessage: "SMTP connection closed after delivery began.",
          retryable: false,
        },
        runtime,
      ),
    );
    const genericRetry = await retryAutomationEvent(
      {
        actorId: adminId,
        eventId: approval.eventId,
        reason: "This must be refused until the ambiguity is explicitly resolved.",
        correlationId: randomUUID(),
      },
      runtime,
    );
    expect(genericRetry).toMatchObject({
      ok: false,
      error: { code: "EMAIL_DELIVERY_UNCERTAIN" },
    });
    valueOf(
      await resolveWelcomeDeliveryUncertainty(
        {
          actorId: adminId,
          notificationId: approval.notificationId,
          action: "CONFIRM_SENT",
          providerReference: "mailpit://integration-confirmed",
          reason: "Mailpit inspection confirmed the message was received exactly once.",
          correlationId: randomUUID(),
        },
        runtime,
      ),
    );
    const [notification, completedOnboarding] = await Promise.all([
      runtime.notificationLog.findUniqueOrThrow({ where: { id: approval.notificationId } }),
      runtime.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } }),
    ]);
    expect(notification.status).toBe(NotificationStatus.SENT);
    expect(completedOnboarding.status).toBe(OnboardingStatus.CLIENT_AWAITING_ACTION);
  });

  it("times out a stale task attempt and rejects its late provider success", async () => {
    const onboarding = await createReadyFixture("PHASE4-TIMEOUT");
    const task = onboarding.provisioningTasks[0]!;
    const event = await runtime.automationEvent.findFirstOrThrow({
      where: {
        eventType: "PROVISIONING_TASK_REQUESTED",
        payload: { path: ["taskId"], equals: task.id },
      },
    });
    const staleClaim = await claimSpecific(event.id);
    const staleCall = machine(event.id, staleClaim.run);
    const start = valueOf(
      await startProvisioningTask(
        { ...staleCall, taskId: task.id, expectedTaskVersion: task.version },
        runtime,
      ),
    );
    if (!start.attemptId || !start.attemptNumber) {
      throw new Error("Expected a reserved provider attempt");
    }
    await runtime.automationEvent.update({
      where: { id: event.id },
      data: { leaseExpiresAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    await claimSpecific(event.id);
    expect(
      (
        await runtime.provisioningTaskAttempt.findUniqueOrThrow({
          where: { id: start.attemptId },
        })
      ).status,
    ).toBe(ProvisioningTaskAttemptStatus.TIMED_OUT);
    const late = await completeProvisioningTask(
      {
        ...staleCall,
        taskId: task.id,
        expectedTaskVersion: start.taskVersion,
        attemptId: start.attemptId,
        attemptNumber: start.attemptNumber,
        externalReference: "sandbox://late-result",
      },
      runtime,
    );
    expect(late).toMatchObject({
      ok: false,
      error: { code: "PROVISIONING_RESULT_CONFLICT" },
    });
  });
});

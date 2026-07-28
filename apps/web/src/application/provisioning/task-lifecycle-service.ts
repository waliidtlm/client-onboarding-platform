import {
  AuditActorType,
  AutomationEventStatus,
  AutomationFailureClassification,
  AutomationRunStatus,
  OnboardingStatus,
  Prisma,
  ProvisioningTaskAttemptStatus,
  ProvisioningTaskStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { executeService, parseInput, reject } from "@/application/commercial/service-support";
import { requireCurrentAutomationRun } from "@/application/automation/binding";
import {
  completeProvisioningTaskSchema,
  failProvisioningTaskSchema,
  startProvisioningTaskSchema,
} from "@/application/provisioning/contracts";
import { progressProvisioning } from "@/application/provisioning/progression";
import type {
  ProvisioningTaskResult,
  ProvisioningTaskStartResult,
} from "@/application/provisioning/types";
import { canStartProvisioningTask } from "@/domain/provisioning/sequential-eligibility";
import { providerFailureTarget } from "@/domain/provisioning/task-state";
import type { Result } from "@/domain/errors";
import { sanitizeAutomationError } from "@/lib/automation/error-sanitizer";
import { retryAvailableAt } from "@/domain/automation/retry-policy";
import { getServerEnvironment } from "@/lib/env";

async function loadBoundTask(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    runId: string;
    idempotencyKey: string;
    workerId: string;
    taskId: string;
  },
) {
  const binding = await requireCurrentAutomationRun(tx, {
    ...input,
    expectedEventType: "PROVISIONING_TASK_REQUESTED",
  });
  if (binding.payload.taskId !== input.taskId) {
    reject("EVENT_BINDING_CONFLICT", "The event does not belong to this provisioning task.");
  }
  const task = await tx.provisioningTask.findUnique({
    where: { id: input.taskId },
    include: {
      onboarding: true,
      attempts: {
        orderBy: { attemptNumber: "desc" },
        take: 1,
        include: { automationRun: { select: { status: true } } },
      },
    },
  });
  if (!task || task.onboardingId !== binding.event.aggregateId) {
    reject("EVENT_BINDING_CONFLICT", "The task and event onboarding do not match.");
  }
  return { binding, task };
}

export async function startProvisioningTask(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<ProvisioningTaskStartResult>> {
  return executeService(async () => {
    const input = parseInput(startProvisioningTaskSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const { binding, task } = await loadBoundTask(tx, input);
        if (task.version !== input.expectedTaskVersion) {
          reject("VERSION_CONFLICT", "The provisioning task changed. Reload its current context.");
        }
        const latestAttempt = task.attempts[0];
        if (
          latestAttempt?.automationRunId === binding.run.id &&
          latestAttempt.status === ProvisioningTaskAttemptStatus.IN_PROGRESS
        ) {
          return {
            instruction: "EXECUTE" as const,
            taskId: task.id,
            taskStatus: task.status,
            taskVersion: task.version,
            attemptId: latestAttempt.id,
            attemptNumber: latestAttempt.attemptNumber,
            idempotencyKey: task.idempotencyKey,
          };
        }

        let effectiveStatus = task.status;
        let effectiveVersion = task.version;
        if (
          task.status === ProvisioningTaskStatus.IN_PROGRESS &&
          latestAttempt?.status === ProvisioningTaskAttemptStatus.IN_PROGRESS &&
          latestAttempt.automationRun.status !== AutomationRunStatus.PROCESSING
        ) {
          await tx.provisioningTaskAttempt.update({
            where: { id: latestAttempt.id },
            data: {
              status: ProvisioningTaskAttemptStatus.TIMED_OUT,
              completedAt: binding.now,
              errorCode: "LEASE_EXPIRED",
              errorMessage: "The automation run expired before recording a provider result.",
              retryable: true,
            },
          });
          await tx.provisioningTask.update({
            where: { id: task.id },
            data: {
              status: ProvisioningTaskStatus.PENDING,
              version: { increment: 1 },
              lastErrorCode: "LEASE_EXPIRED",
              lastErrorMessage: "The previous provider attempt timed out.",
            },
          });
          effectiveStatus = ProvisioningTaskStatus.PENDING;
          effectiveVersion += 1;
        }

        if (
          effectiveStatus === ProvisioningTaskStatus.COMPLETED ||
          effectiveStatus === ProvisioningTaskStatus.MANUALLY_ACCEPTED
        ) {
          return {
            instruction: "SKIP" as const,
            taskId: task.id,
            taskStatus: effectiveStatus,
            taskVersion: effectiveVersion,
          };
        }
        if (effectiveStatus === ProvisioningTaskStatus.MANUAL_REVIEW_REQUIRED) {
          return {
            instruction: "MANUAL_REVIEW" as const,
            taskId: task.id,
            taskStatus: effectiveStatus,
            taskVersion: effectiveVersion,
          };
        }
        if (task.attemptCount >= task.maxAttempts) {
          reject("PROVISIONING_ATTEMPTS_EXHAUSTED", "A manual retry must be authorized.");
        }
        const onboardingStatusAllowed =
          task.onboarding.status === OnboardingStatus.INTERNAL_SETUP ||
          (!task.isRequired &&
            task.onboarding.status === OnboardingStatus.INTERNAL_REVIEW &&
            !task.onboarding.internalReadinessApprovedAt);
        if (!onboardingStatusAllowed) {
          reject("INVALID_TRANSITION", "The onboarding cannot start this task.");
        }
        const tasks = await tx.provisioningTask.findMany({
          where: { onboardingId: task.onboardingId },
          orderBy: { sequence: "asc" },
        });
        const sequencingView = tasks.map((item) =>
          item.id === task.id ? { ...item, status: effectiveStatus } : item,
        );
        if (!canStartProvisioningTask(task.id, sequencingView)) {
          reject("PROVISIONING_SEQUENCE_BLOCKED", "An earlier provisioning task is unresolved.");
        }

        const attemptNumber = task.attemptCount + 1;
        const attempt = await tx.provisioningTaskAttempt.create({
          data: {
            provisioningTaskId: task.id,
            automationRunId: binding.run.id,
            attemptNumber,
            startedAt: binding.now,
          },
        });
        await tx.provisioningTask.update({
          where: { id: task.id },
          data: {
            status: ProvisioningTaskStatus.IN_PROGRESS,
            attemptCount: attemptNumber,
            startedAt: binding.now,
            version: { increment: 1 },
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: task.onboardingId,
          actorType: AuditActorType.SYSTEM,
          action: "PROVISIONING_TASK_STARTED",
          entityType: "PROVISIONING_TASK",
          entityId: task.id,
          previousValue: { status: effectiveStatus, attemptCount: task.attemptCount },
          newValue: { status: ProvisioningTaskStatus.IN_PROGRESS, attemptCount: attemptNumber },
          metadata: {
            automationEventAttempt: binding.event.attemptCount,
            provisioningAttempt: attemptNumber,
          },
          correlationId: binding.event.correlationId,
        });
        return {
          instruction: "EXECUTE" as const,
          taskId: task.id,
          taskStatus: ProvisioningTaskStatus.IN_PROGRESS,
          taskVersion: effectiveVersion + 1,
          attemptId: attempt.id,
          attemptNumber,
          idempotencyKey: task.idempotencyKey,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function completeProvisioningTask(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<ProvisioningTaskResult>> {
  return executeService(async () => {
    const input = parseInput(completeProvisioningTaskSchema.safeParse(rawInput));
    const environment = getServerEnvironment();
    return database.$transaction(
      async (tx) => {
        const replay = await loadProvisioningResultReplay(tx, input);
        if (replay) {
          if (
            replay.run.status === AutomationRunStatus.COMPLETED &&
            replay.event.status === AutomationEventStatus.COMPLETED &&
            replay.task.status === ProvisioningTaskStatus.COMPLETED &&
            replay.attempt.status === ProvisioningTaskAttemptStatus.COMPLETED &&
            replay.task.version === input.expectedTaskVersion + 1 &&
            replay.attempt.externalReference === input.externalReference &&
            replay.task.externalReference === input.externalReference &&
            replay.run.n8nExecutionId === input.n8nExecutionId
          ) {
            return {
              taskId: replay.task.id,
              taskStatus: replay.task.status,
              taskVersion: replay.task.version,
              eventStatus: replay.event.status,
              onboardingStatus: replay.task.onboarding.status,
              nextTaskEventId: null,
              idempotent: true,
            };
          }
          if (
            replay.run.status !== AutomationRunStatus.PROCESSING ||
            replay.attempt.status !== ProvisioningTaskAttemptStatus.IN_PROGRESS
          ) {
            reject(
              "PROVISIONING_RESULT_CONFLICT",
              "The completion conflicts with the recorded terminal result.",
            );
          }
        }
        const { binding, task } = await loadBoundTask(tx, input);
        const attempt = await tx.provisioningTaskAttempt.findUnique({
          where: { id: input.attemptId },
        });
        if (
          !attempt ||
          attempt.provisioningTaskId !== task.id ||
          attempt.automationRunId !== binding.run.id ||
          attempt.attemptNumber !== input.attemptNumber ||
          attempt.status !== ProvisioningTaskAttemptStatus.IN_PROGRESS ||
          task.status !== ProvisioningTaskStatus.IN_PROGRESS ||
          task.version !== input.expectedTaskVersion ||
          task.attemptCount !== input.attemptNumber
        ) {
          reject(
            "PROVISIONING_RESULT_CONFLICT",
            "The completion does not match the active attempt.",
          );
        }
        await tx.provisioningTaskAttempt.update({
          where: { id: attempt.id },
          data: {
            status: ProvisioningTaskAttemptStatus.COMPLETED,
            completedAt: binding.now,
            externalReference: input.externalReference,
          },
        });
        await tx.provisioningTask.update({
          where: { id: task.id },
          data: {
            status: ProvisioningTaskStatus.COMPLETED,
            completedAt: binding.now,
            externalReference: input.externalReference,
            version: { increment: 1 },
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: task.onboardingId,
          actorType: AuditActorType.SYSTEM,
          action: "PROVISIONING_TASK_COMPLETED",
          entityType: "PROVISIONING_TASK",
          entityId: task.id,
          previousValue: { status: task.status },
          newValue: {
            status: ProvisioningTaskStatus.COMPLETED,
            externalReference: input.externalReference,
          },
          metadata: { attemptNumber: input.attemptNumber, provider: "LOCAL_SANDBOX" },
          correlationId: binding.event.correlationId,
        });
        const progression = await progressProvisioning(tx, {
          onboardingId: task.onboardingId,
          correlationId: binding.event.correlationId,
          now: binding.now,
          eventMaxAttempts: environment.AUTOMATION_MAX_ATTEMPTS,
        });
        await tx.automationRun.update({
          where: { id: binding.run.id },
          data: {
            status: AutomationRunStatus.COMPLETED,
            completedAt: binding.now,
            n8nExecutionId: input.n8nExecutionId,
            resultReferences: { taskId: task.id, externalReference: input.externalReference },
          },
        });
        await tx.automationEvent.update({
          where: { id: binding.event.id },
          data: {
            status: AutomationEventStatus.COMPLETED,
            processedAt: binding.now,
            currentRunId: null,
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
          },
        });
        return {
          taskId: task.id,
          taskStatus: ProvisioningTaskStatus.COMPLETED,
          taskVersion: task.version + 1,
          eventStatus: AutomationEventStatus.COMPLETED,
          onboardingStatus: progression.onboardingStatus,
          nextTaskEventId: progression.nextTaskEventId,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function failProvisioningTask(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<ProvisioningTaskResult>> {
  return executeService(async () => {
    const input = parseInput(failProvisioningTaskSchema.safeParse(rawInput));
    const environment = getServerEnvironment();
    const safeMessage = sanitizeAutomationError(input.errorMessage);
    return database.$transaction(
      async (tx) => {
        const replay = await loadProvisioningResultReplay(tx, input);
        if (replay) {
          const taskIsRecordedFailure =
            replay.task.status === ProvisioningTaskStatus.PENDING ||
            replay.task.status === ProvisioningTaskStatus.MANUAL_REVIEW_REQUIRED;
          const eventIsRecordedFailure =
            replay.event.status === AutomationEventStatus.PENDING ||
            replay.event.status === AutomationEventStatus.PROCESSING ||
            replay.event.status === AutomationEventStatus.FAILED;
          if (
            replay.run.status === AutomationRunStatus.FAILED &&
            replay.attempt.status === ProvisioningTaskAttemptStatus.FAILED &&
            taskIsRecordedFailure &&
            eventIsRecordedFailure &&
            replay.task.version === input.expectedTaskVersion + 1 &&
            replay.attempt.retryable === input.retryable &&
            replay.attempt.errorCode === input.errorCode &&
            replay.attempt.errorMessage === safeMessage &&
            replay.run.n8nExecutionId === input.n8nExecutionId
          ) {
            return {
              taskId: replay.task.id,
              taskStatus: replay.task.status,
              taskVersion: replay.task.version,
              eventStatus: replay.event.status,
              onboardingStatus: replay.task.onboarding.status,
              nextTaskEventId: null,
              idempotent: true,
            };
          }
          if (
            replay.run.status !== AutomationRunStatus.PROCESSING ||
            replay.attempt.status !== ProvisioningTaskAttemptStatus.IN_PROGRESS
          ) {
            reject(
              "PROVISIONING_RESULT_CONFLICT",
              "The failure conflicts with the recorded terminal result.",
            );
          }
        }
        const { binding, task } = await loadBoundTask(tx, input);
        const attempt = await tx.provisioningTaskAttempt.findUnique({
          where: { id: input.attemptId },
        });
        if (
          !attempt ||
          attempt.provisioningTaskId !== task.id ||
          attempt.automationRunId !== binding.run.id ||
          attempt.attemptNumber !== input.attemptNumber ||
          attempt.status !== ProvisioningTaskAttemptStatus.IN_PROGRESS ||
          task.status !== ProvisioningTaskStatus.IN_PROGRESS ||
          task.version !== input.expectedTaskVersion ||
          task.attemptCount !== input.attemptNumber
        ) {
          reject("PROVISIONING_RESULT_CONFLICT", "The failure does not match the active attempt.");
        }
        const target = providerFailureTarget({
          retryable: input.retryable,
          attemptCount: task.attemptCount,
          maxAttempts: task.maxAttempts,
        });
        await tx.provisioningTaskAttempt.update({
          where: { id: attempt.id },
          data: {
            status: ProvisioningTaskAttemptStatus.FAILED,
            completedAt: binding.now,
            retryable: input.retryable,
            errorCode: input.errorCode,
            errorMessage: safeMessage,
          },
        });
        await tx.provisioningTask.update({
          where: { id: task.id },
          data: {
            status: target,
            lastErrorCode: input.errorCode,
            lastErrorMessage: safeMessage,
            version: { increment: 1 },
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: task.onboardingId,
          actorType: AuditActorType.SYSTEM,
          action:
            target === ProvisioningTaskStatus.PENDING
              ? "PROVISIONING_TASK_RETRY_SCHEDULED"
              : "PROVISIONING_TASK_MANUAL_REVIEW_REQUIRED",
          entityType: "PROVISIONING_TASK",
          entityId: task.id,
          previousValue: { status: task.status },
          newValue: { status: target, errorCode: input.errorCode },
          metadata: { attemptNumber: input.attemptNumber, retryable: input.retryable },
          correlationId: binding.event.correlationId,
        });

        let progression = {
          nextTaskEventId: null as string | null,
          onboardingStatus: task.onboarding.status,
        };
        if (target === ProvisioningTaskStatus.MANUAL_REVIEW_REQUIRED && !task.isRequired) {
          progression = await progressProvisioning(tx, {
            onboardingId: task.onboardingId,
            correlationId: binding.event.correlationId,
            now: binding.now,
            eventMaxAttempts: environment.AUTOMATION_MAX_ATTEMPTS,
          });
        }
        await tx.automationRun.update({
          where: { id: binding.run.id },
          data: {
            status: AutomationRunStatus.FAILED,
            completedAt: binding.now,
            n8nExecutionId: input.n8nExecutionId,
            errorCode: input.errorCode,
            errorMessage: safeMessage,
            failedNode: "Local sandbox provider",
            failureClassification:
              target === ProvisioningTaskStatus.PENDING
                ? AutomationFailureClassification.RETRYABLE
                : AutomationFailureClassification.OPERATOR_REMEDIABLE,
            failureReportedAt: binding.now,
          },
        });
        const eventStatus =
          target === ProvisioningTaskStatus.PENDING
            ? AutomationEventStatus.PENDING
            : AutomationEventStatus.FAILED;
        await tx.automationEvent.update({
          where: { id: binding.event.id },
          data: {
            status: eventStatus,
            availableAt:
              eventStatus === AutomationEventStatus.PENDING
                ? retryAvailableAt(
                    binding.now,
                    binding.event.attemptCount,
                    environment.AUTOMATION_RETRY_BASE_SECONDS,
                  )
                : binding.event.availableAt,
            currentRunId: null,
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
            lastErrorCode: input.errorCode,
            lastError: safeMessage,
          },
        });
        return {
          taskId: task.id,
          taskStatus: target,
          taskVersion: task.version + 1,
          eventStatus,
          onboardingStatus: progression.onboardingStatus,
          nextTaskEventId: progression.nextTaskEventId,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

async function loadProvisioningResultReplay(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    runId: string;
    idempotencyKey: string;
    workerId: string;
    taskId: string;
    attemptId: string;
    attemptNumber: number;
  },
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "AutomationEvent"
    WHERE "id" = ${input.eventId}::uuid
    FOR UPDATE
  `);
  const [event, run, task, attempt] = await Promise.all([
    tx.automationEvent.findUnique({ where: { id: input.eventId } }),
    tx.automationRun.findUnique({ where: { id: input.runId } }),
    tx.provisioningTask.findUnique({
      where: { id: input.taskId },
      include: { onboarding: true },
    }),
    tx.provisioningTaskAttempt.findUnique({ where: { id: input.attemptId } }),
  ]);
  if (!event || !run || !task || !attempt) return null;
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  if (
    event.eventType !== "PROVISIONING_TASK_REQUESTED" ||
    event.schemaVersion !== 1 ||
    event.aggregateType !== "ONBOARDING" ||
    event.aggregateId !== task.onboardingId ||
    payload.taskId !== task.id ||
    run.automationEventId !== event.id ||
    run.idempotencyKey !== input.idempotencyKey ||
    run.workerId !== input.workerId ||
    attempt.provisioningTaskId !== task.id ||
    attempt.automationRunId !== run.id ||
    attempt.attemptNumber !== input.attemptNumber
  ) {
    reject("EVENT_BINDING_CONFLICT", "The callback identifiers do not describe one task attempt.");
  }
  return { event, run, task, attempt };
}

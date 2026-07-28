import {
  AuditActorType,
  AutomationEventStatus,
  OnboardingStatus,
  Prisma,
  ProvisioningTaskStatus,
  Role,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
} from "@/application/commercial/service-support";
import { manualTaskResolutionSchema } from "@/application/provisioning/contracts";
import { progressProvisioning } from "@/application/provisioning/progression";
import { provisioningTaskEventDeduplicationKey } from "@/domain/provisioning/idempotency";
import type { Result } from "@/domain/errors";
import { getServerEnvironment } from "@/lib/env";

type ManualTaskResult = Readonly<{
  taskId: string;
  taskStatus: ProvisioningTaskStatus;
  eventStatus: AutomationEventStatus;
  onboardingStatus: OnboardingStatus;
  taskVersion: number;
}>;

async function authorizeResolution(
  tx: Prisma.TransactionClient,
  actorId: string,
  onboardingId: string,
) {
  const actor = await requireActor(tx, actorId, [Role.ADMIN, Role.PROJECT_MANAGER]);
  const onboarding = await tx.onboarding.findUnique({ where: { id: onboardingId } });
  if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
  if (actor.role === Role.PROJECT_MANAGER && onboarding.projectManagerId !== actor.id) {
    reject("ACCESS_DENIED", "Only the assigned Project Manager may resolve this task.");
  }
  return onboarding;
}

export async function retryManualProvisioning(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<ManualTaskResult>> {
  return executeService(async () => {
    const input = parseInput(manualTaskResolutionSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const onboarding = await authorizeResolution(tx, input.actorId, input.onboardingId);
        const task = await tx.provisioningTask.findUnique({ where: { id: input.taskId } });
        if (!task || task.onboardingId !== onboarding.id)
          reject("NOT_FOUND", "The task does not exist.");
        if (
          task.status !== ProvisioningTaskStatus.MANUAL_REVIEW_REQUIRED ||
          task.version !== input.expectedTaskVersion
        ) {
          reject("PROVISIONING_TASK_CONFLICT", "The task is not awaiting this resolution.");
        }
        if (
          onboarding.internalReadinessApprovedAt ||
          (onboarding.status !== OnboardingStatus.INTERNAL_SETUP &&
            onboarding.status !== OnboardingStatus.INTERNAL_REVIEW)
        ) {
          reject("INVALID_TRANSITION", "This task is frozen after internal-readiness approval.");
        }
        const event = await tx.automationEvent.findUnique({
          where: { deduplicationKey: provisioningTaskEventDeduplicationKey(task.id) },
        });
        if (!event || event.status !== AutomationEventStatus.FAILED || event.currentRunId) {
          reject("AUTOMATION_EVENT_CONFLICT", "The failed task event is not available for retry.");
        }
        const nextTaskLimit = task.attemptCount + 1;
        await tx.provisioningTask.update({
          where: { id: task.id },
          data: {
            status: ProvisioningTaskStatus.FAILED,
            maxAttempts: nextTaskLimit,
            version: { increment: 1 },
          },
        });
        await tx.automationEvent.update({
          where: { id: event.id },
          data: {
            status: AutomationEventStatus.PENDING,
            availableAt: new Date(),
            maxAttempts: event.attemptCount + 1,
            lastErrorCode: null,
            lastError: null,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "PROVISIONING_TASK_MANUAL_RETRY_AUTHORIZED",
          entityType: "PROVISIONING_TASK",
          entityId: task.id,
          previousValue: { status: task.status, maxAttempts: task.maxAttempts },
          newValue: { status: ProvisioningTaskStatus.FAILED, maxAttempts: nextTaskLimit },
          metadata: { reason: input.reason, automationEventId: event.id },
          correlationId: input.correlationId,
        });
        return {
          taskId: task.id,
          taskStatus: ProvisioningTaskStatus.FAILED,
          eventStatus: AutomationEventStatus.PENDING,
          onboardingStatus: onboarding.status,
          taskVersion: task.version + 1,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function acceptManualProvisioning(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<ManualTaskResult>> {
  return executeService(async () => {
    const input = parseInput(manualTaskResolutionSchema.safeParse(rawInput));
    const environment = getServerEnvironment();
    return database.$transaction(
      async (tx) => {
        const onboarding = await authorizeResolution(tx, input.actorId, input.onboardingId);
        const task = await tx.provisioningTask.findUnique({ where: { id: input.taskId } });
        if (!task || task.onboardingId !== onboarding.id)
          reject("NOT_FOUND", "The task does not exist.");
        if (
          task.status !== ProvisioningTaskStatus.MANUAL_REVIEW_REQUIRED ||
          task.version !== input.expectedTaskVersion
        ) {
          reject("PROVISIONING_TASK_CONFLICT", "The task is not awaiting manual acceptance.");
        }
        if (onboarding.internalReadinessApprovedAt) {
          reject("INVALID_TRANSITION", "This task is frozen after internal-readiness approval.");
        }
        const event = await tx.automationEvent.findUnique({
          where: { deduplicationKey: provisioningTaskEventDeduplicationKey(task.id) },
        });
        if (!event || event.status !== AutomationEventStatus.FAILED || event.currentRunId) {
          reject(
            "AUTOMATION_EVENT_CONFLICT",
            "The failed task event is not available for resolution.",
          );
        }
        const now = new Date();
        await tx.provisioningTask.update({
          where: { id: task.id },
          data: {
            status: ProvisioningTaskStatus.MANUALLY_ACCEPTED,
            manuallyAcceptedById: input.actorId,
            manuallyAcceptedAt: now,
            manualAcceptanceReason: input.reason,
            version: { increment: 1 },
          },
        });
        await tx.automationEvent.update({
          where: { id: event.id },
          data: {
            status: AutomationEventStatus.COMPLETED,
            processedAt: now,
            resolvedById: input.actorId,
            resolvedAt: now,
            resolutionCode: "MANUALLY_ACCEPTED",
            lastErrorCode: event.lastErrorCode,
            lastError: event.lastError,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "PROVISIONING_TASK_MANUALLY_ACCEPTED",
          entityType: "PROVISIONING_TASK",
          entityId: task.id,
          previousValue: { status: task.status },
          newValue: { status: ProvisioningTaskStatus.MANUALLY_ACCEPTED },
          metadata: { reason: input.reason, automationEventId: event.id },
          correlationId: input.correlationId,
        });
        const progression = await progressProvisioning(tx, {
          onboardingId: onboarding.id,
          correlationId: input.correlationId,
          now,
          eventMaxAttempts: environment.AUTOMATION_MAX_ATTEMPTS,
        });
        return {
          taskId: task.id,
          taskStatus: ProvisioningTaskStatus.MANUALLY_ACCEPTED,
          eventStatus: AutomationEventStatus.COMPLETED,
          onboardingStatus: progression.onboardingStatus,
          taskVersion: task.version + 1,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

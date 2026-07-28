import { randomUUID } from "node:crypto";
import {
  AuditActorType,
  AutomationEventStatus,
  AutomationFailureClassification,
  AutomationRunStatus,
  OnboardingStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { executeService, parseInput, reject } from "@/application/commercial/service-support";
import { requireCurrentAutomationRun } from "@/application/automation/binding";
import { appendProvisioningTaskRequestedEvent } from "@/application/automation/event-service";
import { initializeProvisioningSchema } from "@/application/provisioning/contracts";
import type { ProvisioningGenerationResult } from "@/application/provisioning/types";
import {
  provisioningTaskEventDeduplicationKey,
  provisioningTaskIdempotencyKey,
} from "@/domain/provisioning/idempotency";
import type { Result } from "@/domain/errors";
import { getServerEnvironment } from "@/lib/env";

export async function generatePackageTasks(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<ProvisioningGenerationResult>> {
  return executeService(async () => {
    const input = parseInput(initializeProvisioningSchema.safeParse(rawInput));
    const environment = getServerEnvironment();
    const outcome = await database.$transaction(
      async (tx) => {
        const replay = await loadCompletedGenerationReplay(tx, input);
        if (replay) return replay;
        const binding = await requireCurrentAutomationRun(tx, {
          ...input,
          expectedEventType: "ONBOARDING_ACTIVATED",
        });
        const onboarding = await tx.onboarding.findUnique({
          where: { id: binding.event.aggregateId },
          include: {
            projectManager: { select: { id: true, role: true, isActive: true } },
            servicePackage: {
              include: { provisioningTemplates: { orderBy: { sequence: "asc" } } },
            },
            provisioningTasks: { orderBy: { sequence: "asc" } },
          },
        });
        if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");

        if (
          !onboarding.projectManager ||
          !onboarding.projectManager.isActive ||
          onboarding.projectManager.role !== "PROJECT_MANAGER"
        ) {
          await tx.automationRun.update({
            where: { id: binding.run.id },
            data: {
              status: AutomationRunStatus.FAILED,
              completedAt: binding.now,
              n8nExecutionId: input.n8nExecutionId,
              errorCode: "PROJECT_MANAGER_REQUIRED",
              errorMessage: "An active Project Manager must be assigned.",
              failedNode: "Initialize provisioning",
              failureClassification: AutomationFailureClassification.OPERATOR_REMEDIABLE,
              failureReportedAt: binding.now,
            },
          });
          await tx.automationEvent.update({
            where: { id: binding.event.id },
            data: {
              status: AutomationEventStatus.FAILED,
              currentRunId: null,
              claimedBy: null,
              claimedAt: null,
              leaseExpiresAt: null,
              lastErrorCode: "PROJECT_MANAGER_REQUIRED",
              lastError: "An active Project Manager must be assigned.",
            },
          });
          return { kind: "PM_REQUIRED" as const };
        }

        if (onboarding.provisioningTasks.length > 0) {
          const first = onboarding.provisioningTasks[0]!;
          const event = await tx.automationEvent.findUnique({
            where: { deduplicationKey: provisioningTaskEventDeduplicationKey(first.id) },
          });
          if (!event) reject("CONFIGURATION_ERROR", "The generated task event is missing.");
          await tx.automationRun.update({
            where: { id: binding.run.id },
            data: {
              status: AutomationRunStatus.COMPLETED,
              completedAt: binding.now,
              n8nExecutionId: input.n8nExecutionId,
              resultReferences: { firstTaskEventId: event.id },
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
            kind: "SUCCESS" as const,
            value: {
              onboardingId: onboarding.id,
              status: onboarding.status,
              version: onboarding.version,
              taskIds: onboarding.provisioningTasks.map((task) => task.id),
              firstEventId: event.id,
              idempotent: true,
            },
          };
        }

        if (onboarding.status !== OnboardingStatus.READY_FOR_ONBOARDING) {
          reject("INVALID_TRANSITION", "The onboarding is not ready for task generation.");
        }
        const templates = onboarding.servicePackage?.provisioningTemplates ?? [];
        if (
          !onboarding.servicePackage ||
          templates.length === 0 ||
          !templates.some((item) => item.isRequired)
        ) {
          reject(
            "MISSING_BUSINESS_CONFIGURATION",
            "The purchased package needs a required provisioning template.",
          );
        }
        if (
          new Set(templates.map((item) => item.sequence)).size !== templates.length ||
          new Set(templates.map((item) => item.automationKey)).size !== templates.length
        ) {
          reject("MISSING_BUSINESS_CONFIGURATION", "Provisioning template identity is ambiguous.");
        }

        const taskRows = templates.map((template) => {
          const id = randomUUID();
          return {
            id,
            onboardingId: onboarding.id,
            templateId: template.id,
            name: template.name,
            description: template.description,
            sequence: template.sequence,
            isRequired: template.isRequired,
            automationKey: template.automationKey,
            maxAttempts: environment.PROVISIONING_TASK_MAX_ATTEMPTS,
            idempotencyKey: provisioningTaskIdempotencyKey(id),
          };
        });
        await tx.provisioningTask.createMany({ data: taskRows });
        const first = taskRows[0]!;
        const firstEvent = await appendProvisioningTaskRequestedEvent(tx, {
          onboardingId: onboarding.id,
          taskId: first.id,
          correlationId: binding.event.correlationId,
          occurredAt: binding.now,
          maxAttempts: environment.AUTOMATION_MAX_ATTEMPTS,
        });
        const updated = await tx.onboarding.updateMany({
          where: {
            id: onboarding.id,
            version: onboarding.version,
            status: OnboardingStatus.READY_FOR_ONBOARDING,
          },
          data: { status: OnboardingStatus.INTERNAL_SETUP, version: { increment: 1 } },
        });
        if (updated.count !== 1)
          reject("VERSION_CONFLICT", "The onboarding changed during task generation.");

        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.SYSTEM,
          action: "PROVISIONING_TASKS_GENERATED",
          entityType: "ONBOARDING",
          entityId: onboarding.id,
          newValue: { taskCount: taskRows.length, status: OnboardingStatus.INTERNAL_SETUP },
          metadata: { sourceEventId: binding.event.id },
          correlationId: binding.event.correlationId,
        });
        await tx.automationRun.update({
          where: { id: binding.run.id },
          data: {
            status: AutomationRunStatus.COMPLETED,
            completedAt: binding.now,
            n8nExecutionId: input.n8nExecutionId,
            resultReferences: { firstTaskEventId: firstEvent.eventId },
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
          kind: "SUCCESS" as const,
          value: {
            onboardingId: onboarding.id,
            status: OnboardingStatus.INTERNAL_SETUP,
            version: onboarding.version + 1,
            taskIds: taskRows.map((task) => task.id),
            firstEventId: firstEvent.eventId,
            idempotent: false,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (outcome.kind === "PM_REQUIRED") {
      reject("PROJECT_MANAGER_REQUIRED", "Assign an active Project Manager and retry.");
    }
    return outcome.value;
  });
}

async function loadCompletedGenerationReplay(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    runId: string;
    idempotencyKey: string;
    workerId: string;
    n8nExecutionId: string;
  },
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "AutomationEvent"
    WHERE "id" = ${input.eventId}::uuid
    FOR UPDATE
  `);
  const [event, run] = await Promise.all([
    tx.automationEvent.findUnique({ where: { id: input.eventId } }),
    tx.automationRun.findUnique({ where: { id: input.runId } }),
  ]);
  if (
    !event ||
    !run ||
    event.eventType !== "ONBOARDING_ACTIVATED" ||
    event.aggregateType !== "ONBOARDING" ||
    event.schemaVersion !== 1 ||
    run.automationEventId !== event.id ||
    run.idempotencyKey !== input.idempotencyKey ||
    run.workerId !== input.workerId
  ) {
    return null;
  }
  if (run.status === AutomationRunStatus.PROCESSING) return null;
  if (
    run.status !== AutomationRunStatus.COMPLETED ||
    event.status !== AutomationEventStatus.COMPLETED ||
    run.n8nExecutionId !== input.n8nExecutionId
  ) {
    reject("AUTOMATION_RUN_CONFLICT", "The initialization conflicts with the terminal run.");
  }
  const onboarding = await tx.onboarding.findUnique({
    where: { id: event.aggregateId },
    include: { provisioningTasks: { orderBy: { sequence: "asc" } } },
  });
  const first = onboarding?.provisioningTasks[0];
  if (!onboarding || !first) {
    reject("CONFIGURATION_ERROR", "The completed initialization has no task snapshots.");
  }
  const firstEvent = await tx.automationEvent.findUnique({
    where: { deduplicationKey: provisioningTaskEventDeduplicationKey(first.id) },
  });
  if (!firstEvent) reject("CONFIGURATION_ERROR", "The first task event is missing.");
  return {
    kind: "SUCCESS" as const,
    value: {
      onboardingId: onboarding.id,
      status: onboarding.status,
      version: onboarding.version,
      taskIds: onboarding.provisioningTasks.map((task) => task.id),
      firstEventId: firstEvent.id,
      idempotent: true,
    },
  };
}

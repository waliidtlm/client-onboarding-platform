import {
  OnboardingStatus,
  Prisma,
  ProvisioningTaskAttemptStatus,
  ProvisioningTaskStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { requireCurrentAutomationRun } from "@/application/automation/binding";
import { executeService, parseInput, reject } from "@/application/commercial/service-support";
import { executeSandboxTaskSchema } from "@/application/provisioning/contracts";
import {
  executeSandboxProvisioning,
  type SandboxProviderResult,
} from "@/infrastructure/provisioning/sandbox-provisioning-adapter";
import type { Result } from "@/domain/errors";

export async function executeSandboxProvisioningTask(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<SandboxProviderResult>> {
  return executeService(async () => {
    const input = parseInput(executeSandboxTaskSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const binding = await requireCurrentAutomationRun(tx, {
          ...input,
          expectedEventType: "PROVISIONING_TASK_REQUESTED",
        });
        if (binding.payload.taskId !== input.taskId) {
          reject("EVENT_BINDING_CONFLICT", "The event does not identify this task.");
        }
        const task = await tx.provisioningTask.findUnique({
          where: { id: input.taskId },
          include: {
            onboarding: true,
            attempts: { where: { id: input.attemptId }, take: 1 },
          },
        });
        const attempt = task?.attempts[0];
        if (
          !task ||
          task.onboardingId !== binding.event.aggregateId ||
          task.version !== input.expectedTaskVersion ||
          task.status !== ProvisioningTaskStatus.IN_PROGRESS ||
          task.attemptCount !== input.attemptNumber ||
          !attempt ||
          attempt.automationRunId !== binding.run.id ||
          attempt.attemptNumber !== input.attemptNumber ||
          attempt.status !== ProvisioningTaskAttemptStatus.IN_PROGRESS
        ) {
          reject(
            "PROVISIONING_TASK_CONFLICT",
            "The sandbox request is not bound to the active task attempt.",
          );
        }
        if (
          task.onboarding.status !== OnboardingStatus.INTERNAL_SETUP &&
          task.onboarding.status !== OnboardingStatus.INTERNAL_REVIEW
        ) {
          reject("INVALID_TRANSITION", "The onboarding is not in a provisioning state.");
        }
        const earlier = await tx.provisioningTask.findMany({
          where: { onboardingId: task.onboardingId, sequence: { lt: task.sequence } },
        });
        if (
          earlier.some(
            (item) =>
              item.status !== ProvisioningTaskStatus.COMPLETED &&
              item.status !== ProvisioningTaskStatus.MANUALLY_ACCEPTED &&
              !(!item.isRequired && item.status === ProvisioningTaskStatus.MANUAL_REVIEW_REQUIRED),
          )
        ) {
          reject(
            "PROVISIONING_SEQUENCE_BLOCKED",
            "An earlier task is not in an allowed sequencing outcome.",
          );
        }
        return executeSandboxProvisioning(tx, {
          taskId: task.id,
          idempotencyKey: task.idempotencyKey,
          automationKey: task.automationKey,
          taskName: task.name,
          attemptNumber: input.attemptNumber,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

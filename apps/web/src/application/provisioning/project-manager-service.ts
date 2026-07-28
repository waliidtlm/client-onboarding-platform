import {
  AuditActorType,
  AutomationEventStatus,
  OnboardingStatus,
  Prisma,
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
import { assignProjectManagerSchema } from "@/application/provisioning/contracts";
import { onboardingActivatedDeduplicationKey } from "@/domain/automation/idempotency";
import type { Result } from "@/domain/errors";

export type ProjectManagerAssignmentResult = Readonly<{
  onboardingId: string;
  projectManagerId: string;
  version: number;
  activationEventRequeued: boolean;
}>;

export async function assignProjectManager(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<ProjectManagerAssignmentResult>> {
  return executeService(async () => {
    const input = parseInput(assignProjectManagerSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.OPERATIONS]);
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${input.onboardingId}::uuid
          FOR UPDATE
        `);
        const [onboarding, target] = await Promise.all([
          tx.onboarding.findUnique({
            where: { id: input.onboardingId },
            include: {
              provisioningTasks: {
                where: { status: "IN_PROGRESS" },
                select: { id: true },
              },
            },
          }),
          tx.user.findUnique({ where: { id: input.projectManagerId } }),
        ]);
        if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
        if (!target?.isActive || target.role !== Role.PROJECT_MANAGER) {
          reject("INVALID_INPUT", "Select an active Project Manager.");
        }
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        if (onboarding.provisioningTasks.length > 0) {
          reject(
            "INVALID_TRANSITION",
            "A Project Manager cannot be reassigned while a task is running.",
          );
        }
        if (onboarding.internalReadinessApprovedAt) {
          reject("INVALID_TRANSITION", "Readiness was already approved.");
        }
        if (
          onboarding.status !== OnboardingStatus.READY_FOR_ONBOARDING &&
          onboarding.status !== OnboardingStatus.INTERNAL_SETUP &&
          onboarding.status !== OnboardingStatus.INTERNAL_REVIEW
        ) {
          reject("INVALID_TRANSITION", "The onboarding is not in an assignable Phase 4 state.");
        }
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: {
            projectManagerId: target.id,
            version: { increment: 1 },
          },
        });
        const activationEvent = await tx.automationEvent.findUnique({
          where: { deduplicationKey: onboardingActivatedDeduplicationKey(onboarding.id) },
        });
        const mayRequeue =
          activationEvent?.status === AutomationEventStatus.FAILED &&
          activationEvent.lastErrorCode === "PROJECT_MANAGER_REQUIRED" &&
          !activationEvent.currentRunId;
        if (activationEvent && mayRequeue) {
          await tx.automationEvent.update({
            where: { id: activationEvent.id },
            data: {
              status: AutomationEventStatus.PENDING,
              availableAt: new Date(),
              maxAttempts: Math.max(activationEvent.maxAttempts, activationEvent.attemptCount + 1),
              lastErrorCode: null,
              lastError: null,
            },
          });
        }
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: onboarding.projectManagerId
            ? "PROJECT_MANAGER_REASSIGNED"
            : "PROJECT_MANAGER_ASSIGNED",
          entityType: "ONBOARDING",
          entityId: onboarding.id,
          previousValue: { projectManagerId: onboarding.projectManagerId },
          newValue: { projectManagerId: target.id },
          metadata: { activationEventRequeued: mayRequeue },
          correlationId: input.correlationId,
        });
        return {
          onboardingId: onboarding.id,
          projectManagerId: target.id,
          version: onboarding.version + 1,
          activationEventRequeued: mayRequeue,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

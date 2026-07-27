import {
  AuditActorType,
  CommercialGateStatus,
  OnboardingStatus,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { refreshCommercialState } from "@/application/commercial/commercial-gate-service";
import { cancelOnboardingSchema } from "@/application/commercial/schemas";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
  type DatabaseClient,
} from "@/application/commercial/service-support";
import type { CommercialMutationResult } from "@/application/commercial/types";
import { canCancelOnboarding } from "@/domain/commercial/transitions";
import type { Result } from "@/domain/errors";

export async function cancelOnboarding(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(cancelOnboardingSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const actor = await requireActor(tx, input.actorId, [Role.ADMIN, Role.OPERATIONS]);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
        });
        if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
        if (onboarding.status === OnboardingStatus.CANCELLED) {
          return {
            onboardingId: onboarding.id,
            version: onboarding.version,
            status: onboarding.status,
            commercialGateStatus: CommercialGateStatus.CANCELLED,
            blockingReasons: onboarding.commercialGateBlockingReasons,
            activatedAt: onboarding.activatedAt?.toISOString() ?? null,
            idempotent: true,
          };
        }
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        if (!canCancelOnboarding(onboarding.status)) {
          reject("INVALID_TRANSITION", "The onboarding cannot be cancelled in this state.");
        }
        if (
          actor.role === Role.OPERATIONS &&
          onboarding.status === OnboardingStatus.READY_FOR_ONBOARDING
        ) {
          reject("ACCESS_DENIED", "Only an administrator can cancel after activation.");
        }

        const cancelledAt = new Date();
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: {
            status: OnboardingStatus.CANCELLED,
            cancelledAt,
            cancellationReason: input.reason,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "ONBOARDING_CANCELLED",
          entityType: "ONBOARDING",
          entityId: onboarding.id,
          previousValue: { status: onboarding.status },
          newValue: {
            status: OnboardingStatus.CANCELLED,
            cancelledAt: cancelledAt.toISOString(),
          },
          metadata: { reasonProvided: true },
          correlationId: input.correlationId,
        });
        return refreshCommercialState(tx, {
          onboardingId: onboarding.id,
          expectedVersion: input.expectedVersion,
          correlationId: input.correlationId,
          triggeredByActorId: input.actorId,
          forceVersionIncrement: true,
          now: cancelledAt,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

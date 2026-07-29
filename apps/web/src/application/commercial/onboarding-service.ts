import {
  AuditActorType,
  AutomationEventStatus,
  CommercialGateStatus,
  NotificationStatus,
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
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${input.onboardingId}::uuid
          FOR UPDATE
        `);
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
          (onboarding.status === OnboardingStatus.READY_FOR_ONBOARDING ||
            onboarding.status === OnboardingStatus.INTERNAL_REVIEW ||
            onboarding.status === OnboardingStatus.CLIENT_AWAITING_ACTION ||
            onboarding.status === OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE)
        ) {
          reject("ACCESS_DENIED", "Only an administrator can cancel after activation.");
        }

        const cancelledAt = new Date();
        const activeTokens = await tx.clientAccessToken.findMany({
          where: { onboardingId: onboarding.id, revokedAt: null },
          select: { id: true },
        });
        for (const token of activeTokens) {
          await tx.clientAccessToken.update({
            where: { id: token.id },
            data: {
              revokedAt: cancelledAt,
              revocationReason: "ONBOARDING_CANCELLED",
            },
          });
          await appendAuditEvent(tx, {
            onboardingId: onboarding.id,
            actorType: AuditActorType.STAFF,
            actorId: input.actorId,
            action: "CLIENT_ACCESS_REVOKED_ON_CANCELLATION",
            entityType: "CLIENT_ACCESS_TOKEN",
            entityId: token.id,
            previousValue: { revokedAt: null },
            newValue: { revokedAt: cancelledAt.toISOString() },
            metadata: { tokenId: token.id },
            correlationId: input.correlationId,
          });
        }
        await tx.notificationLog.updateMany({
          where: {
            onboardingId: onboarding.id,
            clientAccessTokenId: { not: null },
            status: { in: [NotificationStatus.PENDING, NotificationStatus.FAILED] },
          },
          data: {
            status: NotificationStatus.FAILED,
            failureReason: "Onboarding was cancelled before secure access delivery.",
          },
        });
        await tx.automationEvent.updateMany({
          where: {
            aggregateId: onboarding.id,
            eventType: "CLIENT_ACCESS_EMAIL_REQUESTED",
            status: { in: [AutomationEventStatus.PENDING, AutomationEventStatus.FAILED] },
          },
          data: {
            status: AutomationEventStatus.FAILED,
            lastErrorCode: "ONBOARDING_CANCELLED",
            lastError: "Onboarding was cancelled before secure access delivery.",
          },
        });
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

import {
  AuditActorType,
  AutomationEventStatus,
  CommercialGateStatus,
  DeliveryHandoffStatus,
  KickoffStatus,
  NotificationChannel,
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
import {
  phase6CancellationNotificationKey,
  phase6EventKey,
  phase6Fingerprint,
} from "@/domain/phase6/idempotency";
import { getServerEnvironment } from "@/lib/env";

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
          include: { client: true, kickoff: true, deliveryHandoff: true },
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
        if (actor.role === Role.OPERATIONS && onboarding.activatedAt !== null) {
          reject("ACCESS_DENIED", "Only an administrator can cancel after activation.");
        }

        const cancelledAt = new Date();
        const unresolvedPhase6Delivery = await tx.notificationLog.findFirst({
          where: {
            onboardingId: onboarding.id,
            notificationType: {
              in: ["KICKOFF_INVITATION", "DELIVERY_HANDOFF_NOTIFICATION"],
            },
            status: {
              in: [NotificationStatus.SENDING, NotificationStatus.DELIVERY_UNCERTAIN],
            },
          },
        });
        if (unresolvedPhase6Delivery) {
          reject(
            "EMAIL_DELIVERY_UNCERTAIN",
            "Resolve the active Phase 6 notification delivery before cancellation.",
          );
        }
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
        if (
          onboarding.kickoff &&
          (onboarding.kickoff.status === KickoffStatus.PENDING ||
            onboarding.kickoff.status === KickoffStatus.SCHEDULED)
        ) {
          await tx.kickoff.update({
            where: { id: onboarding.kickoff.id },
            data: {
              status: KickoffStatus.CANCELLED,
              cancelledAt,
              cancelledById: actor.id,
              cancellationReason: input.reason,
              version: { increment: 1 },
            },
          });
        }
        if (
          onboarding.deliveryHandoff &&
          onboarding.deliveryHandoff.status !== DeliveryHandoffStatus.ACKNOWLEDGED &&
          onboarding.deliveryHandoff.status !== DeliveryHandoffStatus.CANCELLED
        ) {
          await tx.deliveryHandoff.update({
            where: { id: onboarding.deliveryHandoff.id },
            data: {
              status: DeliveryHandoffStatus.CANCELLED,
              cancelledAt,
              cancellationReason: input.reason,
              version: { increment: 1 },
            },
          });
        }
        const sentInvitation = onboarding.kickoff
          ? await tx.notificationLog.findFirst({
              where: {
                kickoffId: onboarding.kickoff.id,
                notificationType: "KICKOFF_INVITATION",
                status: NotificationStatus.SENT,
              },
            })
          : null;
        if (
          onboarding.client &&
          (sentInvitation || onboarding.kickoff?.status === KickoffStatus.COMPLETED)
        ) {
          const revision = (onboarding.kickoff?.scheduleRevision ?? 0) + 1;
          const notificationKey = phase6CancellationNotificationKey(onboarding.id, revision);
          const fingerprint = phase6Fingerprint({
            onboardingId: onboarding.id,
            reason: input.reason,
            revision,
          });
          const cancellation = await tx.notificationLog.create({
            data: {
              onboardingId: onboarding.id,
              kickoffId: onboarding.deliveryHandoff ? null : (onboarding.kickoff?.id ?? null),
              deliveryHandoffId: onboarding.deliveryHandoff?.id ?? null,
              notificationType: "PHASE6_CANCELLATION",
              recipient: onboarding.client.contactEmail,
              channel: NotificationChannel.EMAIL,
              status: NotificationStatus.PENDING,
              idempotencyKey: notificationKey,
              senderKey: "NORTHSTAR_PHASE6_V1",
              senderName: "Northstar Growth Agency",
              senderAddress: "onboarding@northstar.test",
              subject: "Onboarding cancelled",
              textContent: [
                `Hello ${onboarding.client.contactName},`,
                "",
                "Your onboarding has been cancelled.",
                "Please contact your Project Manager if you have questions.",
              ].join("\n"),
              htmlContent: null,
              templateVersion: 1,
              messageKey: notificationKey,
              businessRevision: revision,
              requestFingerprint: fingerprint,
            },
          });
          await tx.automationEvent.create({
            data: {
              eventType: "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED",
              aggregateType: "ONBOARDING",
              aggregateId: onboarding.id,
              payload: { notificationId: cancellation.id },
              schemaVersion: 1,
              maxAttempts: getServerEnvironment().AUTOMATION_MAX_ATTEMPTS,
              availableAt: cancelledAt,
              occurredAt: cancelledAt,
              correlationId: input.correlationId,
              deduplicationKey: phase6EventKey(
                cancellation.id,
                "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED",
              ),
            },
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
        await tx.notificationLog.updateMany({
          where: {
            onboardingId: onboarding.id,
            notificationType: {
              in: ["KICKOFF_INVITATION", "DELIVERY_HANDOFF_NOTIFICATION"],
            },
            status: { in: [NotificationStatus.PENDING, NotificationStatus.FAILED] },
          },
          data: {
            status: NotificationStatus.FAILED,
            failureReason: "Onboarding was cancelled before Phase 6 notification delivery.",
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
        await tx.automationEvent.updateMany({
          where: {
            aggregateId: onboarding.id,
            eventType: {
              in: ["KICKOFF_INVITATION_REQUESTED", "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED"],
            },
            status: { in: [AutomationEventStatus.PENDING, AutomationEventStatus.FAILED] },
          },
          data: {
            status: AutomationEventStatus.FAILED,
            lastErrorCode: "ONBOARDING_CANCELLED",
            lastError: "Onboarding was cancelled before Phase 6 notification delivery.",
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

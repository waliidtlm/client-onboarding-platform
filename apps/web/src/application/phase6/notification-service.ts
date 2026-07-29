import nodemailer from "nodemailer";

import {
  AuditActorType,
  AutomationEventStatus,
  AutomationFailureClassification,
  AutomationRunStatus,
  DeliveryHandoffStatus,
  NotificationStatus,
  Role,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";

import {
  requireCurrentAutomationRun,
  completeBoundAutomationRun,
} from "@/application/automation/binding";
import { appendAuditEvent } from "@/application/commercial/audit";
import {
  executeService,
  parseInput,
  reject,
  type TransactionClient,
} from "@/application/commercial/service-support";
import { machinePhase6RunSchema } from "@/application/phase6/contracts";
import { resolvePhase6UncertaintySchema } from "@/application/phase6/contracts";
import { requireActor } from "@/application/commercial/service-support";
import type { SupportedAutomationEventType } from "@/domain/automation/idempotency";
import { phase6EventKey } from "@/domain/phase6/idempotency";
import { prisma } from "@/lib/database";
import { getServerEnvironment } from "@/lib/env";

const PHASE6_NOTIFICATION_EVENTS = [
  "KICKOFF_INVITATION_REQUESTED",
  "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED",
  "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED",
] as const;
type Phase6NotificationEvent = (typeof PHASE6_NOTIFICATION_EVENTS)[number];

function isPhase6NotificationEvent(value: string): value is Phase6NotificationEvent {
  return PHASE6_NOTIFICATION_EVENTS.includes(value as Phase6NotificationEvent);
}

async function lockOnboarding(tx: TransactionClient, onboardingId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Onboarding" WHERE "id" = ${onboardingId}::uuid FOR UPDATE
  `);
}

export async function deliverPhase6Notification(
  rawInput: unknown,
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const input = parseInput(machinePhase6RunSchema.safeParse(rawInput));
    const prepared = await database.$transaction(async (tx) => {
      const [eventHint, runHint] = await Promise.all([
        tx.automationEvent.findUnique({ where: { id: input.eventId } }),
        tx.automationRun.findUnique({ where: { id: input.runId } }),
      ]);
      if (!eventHint || !runHint || runHint.automationEventId !== eventHint.id) {
        reject("NOT_FOUND", "The automation event or run does not exist.");
      }
      if (!isPhase6NotificationEvent(eventHint.eventType)) {
        reject("EVENT_BINDING_CONFLICT", "This is not a Phase 6 notification event.");
      }
      const payload =
        eventHint.payload &&
        typeof eventHint.payload === "object" &&
        !Array.isArray(eventHint.payload)
          ? (eventHint.payload as Record<string, unknown>)
          : {};
      if (typeof payload.notificationId !== "string") {
        reject("INVALID_EVENT_INTEGRITY", "The notification event payload is invalid.");
      }
      await lockOnboarding(tx, eventHint.aggregateId);
      const notification = await tx.notificationLog.findUnique({
        where: { id: payload.notificationId },
      });
      if (!notification || notification.onboardingId !== eventHint.aggregateId) {
        reject("EVENT_BINDING_CONFLICT", "The notification does not belong to the event.");
      }
      if (
        runHint.status === AutomationRunStatus.COMPLETED &&
        eventHint.status === AutomationEventStatus.COMPLETED &&
        notification.status === NotificationStatus.SENT &&
        runHint.workerId === input.workerId &&
        runHint.idempotencyKey === input.idempotencyKey
      ) {
        return {
          replay: true as const,
          providerReference: notification.providerReference,
          notification,
        };
      }
      const binding = await requireCurrentAutomationRun(tx, {
        ...input,
        expectedEventType: eventHint.eventType as SupportedAutomationEventType,
      });
      const deliveryAttemptKey = `PHASE6_DELIVERY:${notification.id}:event-attempt:${eventHint.attemptCount}`;
      if (
        notification.status === NotificationStatus.SENDING &&
        notification.deliveryAttemptKey === deliveryAttemptKey
      ) {
        return { replay: false as const, binding, notification, deliveryAttemptKey };
      }
      if (
        notification.status !== NotificationStatus.PENDING &&
        notification.status !== NotificationStatus.FAILED
      ) {
        reject(
          notification.status === NotificationStatus.DELIVERY_UNCERTAIN
            ? "EMAIL_DELIVERY_UNCERTAIN"
            : "EMAIL_DELIVERY_CONFLICT",
          "The Phase 6 notification is not eligible for delivery.",
        );
      }
      await tx.notificationLog.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.SENDING,
          attemptCount: { increment: 1 },
          deliveryAttemptKey,
          deliveryStartedAt: binding.now,
          failureReason: null,
        },
      });
      return { replay: false as const, binding, notification, deliveryAttemptKey };
    });
    if (prepared.replay) {
      return {
        status: NotificationStatus.SENT,
        providerReference: prepared.providerReference,
        idempotent: true,
      };
    }
    const environment = getServerEnvironment();
    try {
      const transport = nodemailer.createTransport({
        host: environment.SMTP_HOST,
        port: environment.SMTP_PORT,
        secure: false,
      });
      const sent = await transport.sendMail({
        from: {
          name: prepared.notification.senderName,
          address: prepared.notification.senderAddress,
        },
        to: prepared.notification.recipient,
        subject: prepared.notification.subject,
        text: prepared.notification.textContent,
        html: prepared.notification.htmlContent ?? undefined,
        headers: { "X-Notification-Key": prepared.notification.messageKey },
      });
      const providerReference = sent.messageId || prepared.notification.messageKey;
      await database.$transaction(async (tx) => {
        await lockOnboarding(tx, prepared.notification.onboardingId);
        const binding = await requireCurrentAutomationRun(tx, {
          ...input,
          expectedEventType: prepared.binding.event.eventType as SupportedAutomationEventType,
        });
        const current = await tx.notificationLog.findUniqueOrThrow({
          where: { id: prepared.notification.id },
        });
        if (
          current.status !== NotificationStatus.SENDING ||
          current.deliveryAttemptKey !== prepared.deliveryAttemptKey
        ) {
          reject("EMAIL_DELIVERY_CONFLICT", "The notification delivery attempt changed.");
        }
        await tx.notificationLog.update({
          where: { id: current.id },
          data: {
            status: NotificationStatus.SENT,
            providerReference,
            sentAt: binding.now,
            failureReason: null,
          },
        });
        if (binding.event.eventType === "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED") {
          const handoff = current.deliveryHandoffId
            ? await tx.deliveryHandoff.findUnique({ where: { id: current.deliveryHandoffId } })
            : null;
          if (
            !handoff ||
            handoff.status !== DeliveryHandoffStatus.READY ||
            handoff.assignmentRevision !== current.businessRevision
          ) {
            reject("EVENT_BINDING_CONFLICT", "The delivery handoff revision no longer matches.");
          }
          await tx.deliveryHandoff.update({
            where: { id: handoff.id },
            data: { status: DeliveryHandoffStatus.NOTIFIED, version: { increment: 1 } },
          });
        }
        await appendAuditEvent(tx, {
          onboardingId: current.onboardingId,
          actorType: AuditActorType.SYSTEM,
          action: `${current.notificationType}_SENT`,
          entityType: "NOTIFICATION",
          entityId: current.id,
          previousValue: { status: NotificationStatus.SENDING },
          newValue: { status: NotificationStatus.SENT },
          metadata: { messageKey: current.messageKey },
          correlationId: binding.event.correlationId,
        });
        await completeBoundAutomationRun(tx, binding, {
          n8nExecutionId: input.n8nExecutionId,
          resultReferences: { notificationId: current.id, providerReference },
        });
      });
      return { status: NotificationStatus.SENT, providerReference, idempotent: false };
    } catch {
      await database.$transaction(async (tx) => {
        await lockOnboarding(tx, prepared.notification.onboardingId);
        const binding = await requireCurrentAutomationRun(tx, {
          ...input,
          expectedEventType: prepared.binding.event.eventType as SupportedAutomationEventType,
        });
        const message = "SMTP delivery outcome could not be confirmed.";
        await tx.notificationLog.update({
          where: { id: prepared.notification.id },
          data: { status: NotificationStatus.DELIVERY_UNCERTAIN, failureReason: message },
        });
        await tx.automationRun.update({
          where: { id: binding.run.id },
          data: {
            status: AutomationRunStatus.FAILED,
            completedAt: binding.now,
            n8nExecutionId: input.n8nExecutionId,
            errorCode: "EMAIL_DELIVERY_UNCERTAIN",
            errorMessage: message,
            failedNode: "Application SMTP delivery",
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
            lastErrorCode: "EMAIL_DELIVERY_UNCERTAIN",
            lastError: message,
          },
        });
      });
      return { status: NotificationStatus.DELIVERY_UNCERTAIN, idempotent: false };
    }
  });
}

function eventTypeForNotification(notificationType: string): Phase6NotificationEvent | null {
  if (notificationType === "KICKOFF_INVITATION") return "KICKOFF_INVITATION_REQUESTED";
  if (notificationType === "DELIVERY_HANDOFF_NOTIFICATION") {
    return "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED";
  }
  if (notificationType === "PHASE6_CANCELLATION") {
    return "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED";
  }
  return null;
}

export async function resolvePhase6NotificationUncertainty(
  rawInput: unknown,
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const input = parseInput(resolvePhase6UncertaintySchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN]);
        const notification = await tx.notificationLog.findUnique({
          where: { id: input.notificationId },
        });
        if (!notification || notification.status !== NotificationStatus.DELIVERY_UNCERTAIN) {
          reject("EMAIL_DELIVERY_CONFLICT", "The notification is not awaiting resolution.");
        }
        await lockOnboarding(tx, notification.onboardingId);
        const onboarding = await tx.onboarding.findUniqueOrThrow({
          where: { id: notification.onboardingId },
        });
        if (onboarding.version !== input.expectedOnboardingVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and try again.");
        }
        const eventType = eventTypeForNotification(notification.notificationType);
        if (!eventType) reject("EMAIL_DELIVERY_CONFLICT", "This is not a Phase 6 notification.");
        const event = await tx.automationEvent.findUnique({
          where: { deduplicationKey: phase6EventKey(notification.id, eventType) },
        });
        if (!event || event.status !== AutomationEventStatus.FAILED || event.currentRunId) {
          reject("AUTOMATION_EVENT_CONFLICT", "The notification event is not resolvable.");
        }
        const clock = await tx.$queryRaw<Array<{ now: Date }>>(
          Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
        );
        const now = clock[0]!.now;
        if (input.decision === "CONFIRM_SENT") {
          await tx.notificationLog.update({
            where: { id: notification.id },
            data: {
              status: NotificationStatus.SENT,
              providerReference:
                input.providerReference ??
                notification.providerReference ??
                notification.messageKey,
              sentAt: now,
              failureReason: null,
            },
          });
          if (eventType === "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED") {
            const handoff = notification.deliveryHandoffId
              ? await tx.deliveryHandoff.findUnique({
                  where: { id: notification.deliveryHandoffId },
                  include: { assignedDeliveryUser: true },
                })
              : null;
            if (
              handoff?.status === DeliveryHandoffStatus.READY &&
              handoff.assignmentRevision === notification.businessRevision &&
              handoff.assignedDeliveryUser?.isActive
            ) {
              await tx.deliveryHandoff.update({
                where: { id: handoff.id },
                data: { status: DeliveryHandoffStatus.NOTIFIED, version: { increment: 1 } },
              });
            }
          }
          await tx.automationEvent.update({
            where: { id: event.id },
            data: {
              status: AutomationEventStatus.COMPLETED,
              processedAt: now,
              resolvedById: input.actorId,
              resolvedAt: now,
              resolutionCode: "DELIVERY_CONFIRMED_SENT",
            },
          });
        } else {
          if (
            onboarding.status === "CANCELLED" &&
            eventType !== "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED"
          ) {
            reject("INVALID_TRANSITION", "This notification cannot be retried after cancellation.");
          }
          await tx.notificationLog.update({
            where: { id: notification.id },
            data: {
              status: NotificationStatus.FAILED,
              deliveryAttemptKey: null,
              deliveryStartedAt: null,
              failureReason: "An administrator authorized exactly one resend.",
            },
          });
          await tx.automationEvent.update({
            where: { id: event.id },
            data: {
              status: AutomationEventStatus.PENDING,
              availableAt: now,
              maxAttempts: event.attemptCount + 1,
              lastErrorCode: null,
              lastError: null,
            },
          });
        }
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action:
            input.decision === "CONFIRM_SENT"
              ? "PHASE6_NOTIFICATION_DELIVERY_CONFIRMED"
              : "PHASE6_NOTIFICATION_RESEND_AUTHORIZED",
          entityType: "NOTIFICATION",
          entityId: notification.id,
          previousValue: { status: NotificationStatus.DELIVERY_UNCERTAIN },
          newValue: {
            status:
              input.decision === "CONFIRM_SENT"
                ? NotificationStatus.SENT
                : NotificationStatus.FAILED,
          },
          metadata: { reason: input.reason },
          correlationId: input.correlationId,
        });
        return { decision: input.decision, eventId: event.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

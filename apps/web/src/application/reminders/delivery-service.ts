import nodemailer from "nodemailer";

import {
  AuditActorType,
  AutomationEventStatus,
  AutomationFailureClassification,
  AutomationRunStatus,
  NotificationStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";

import {
  completeBoundAutomationRun,
  requireCurrentAutomationRun,
} from "@/application/automation/binding";
import { appendAuditEvent } from "@/application/commercial/audit";
import {
  executeService,
  parseInput,
  reject,
  type TransactionClient,
} from "@/application/commercial/service-support";
import { deliverReminderSchema } from "@/application/reminders/contracts";
import {
  REMINDER_CATEGORIES,
  reminderPolicyStopped,
  type ReminderCategory,
} from "@/domain/reminders/policy";
import { prisma } from "@/lib/database";
import { getServerEnvironment } from "@/lib/env";

type ReminderPayload = Readonly<{
  notificationId: string;
  category: ReminderCategory;
  subjectId: string;
  policyWindow: string;
}>;

function parsePayload(value: unknown): ReminderPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (
    typeof payload.notificationId !== "string" ||
    typeof payload.subjectId !== "string" ||
    typeof payload.policyWindow !== "string" ||
    typeof payload.category !== "string" ||
    !REMINDER_CATEGORIES.includes(payload.category as ReminderCategory)
  ) {
    return null;
  }
  return payload as ReminderPayload;
}

async function currentSubjectStatus(
  tx: TransactionClient,
  payload: ReminderPayload,
): Promise<string | null> {
  if (payload.category === "CLIENT_REQUIREMENT") {
    return (
      (
        await tx.clientRequirement.findUnique({
          where: { id: payload.subjectId },
          select: { status: true },
        })
      )?.status ?? null
    );
  }
  if (payload.category === "PROVISIONING_MANUAL_REVIEW") {
    return (
      (
        await tx.provisioningTask.findUnique({
          where: { id: payload.subjectId },
          select: { status: true },
        })
      )?.status ?? null
    );
  }
  if (payload.category === "KICKOFF_UNSCHEDULED") {
    return (
      (
        await tx.kickoff.findUnique({
          where: { id: payload.subjectId },
          select: { status: true },
        })
      )?.status ?? null
    );
  }
  return (
    (
      await tx.deliveryHandoff.findUnique({
        where: { id: payload.subjectId },
        select: { status: true },
      })
    )?.status ?? null
  );
}

async function lockOnboarding(tx: TransactionClient, onboardingId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Onboarding" WHERE "id" = ${onboardingId}::uuid FOR UPDATE
  `);
}

export async function deliverReminderNotification(
  rawInput: unknown,
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const input = parseInput(deliverReminderSchema.safeParse(rawInput));
    const prepared = await database.$transaction(async (tx) => {
      const [eventHint, runHint] = await Promise.all([
        tx.automationEvent.findUnique({ where: { id: input.eventId } }),
        tx.automationRun.findUnique({ where: { id: input.runId } }),
      ]);
      if (!eventHint || !runHint || runHint.automationEventId !== eventHint.id) {
        reject("NOT_FOUND", "The automation event or run does not exist.");
      }
      if (eventHint.eventType !== "REMINDER_NOTIFICATION_REQUESTED") {
        reject("EVENT_BINDING_CONFLICT", "This is not a reminder notification event.");
      }
      const payload = parsePayload(eventHint.payload);
      if (!payload) reject("INVALID_EVENT_INTEGRITY", "The reminder payload is invalid.");
      await lockOnboarding(tx, eventHint.aggregateId);
      const [notification, onboarding, subjectStatus] = await Promise.all([
        tx.notificationLog.findUnique({ where: { id: payload.notificationId } }),
        tx.onboarding.findUnique({
          where: { id: eventHint.aggregateId },
          select: { status: true },
        }),
        currentSubjectStatus(tx, payload),
      ]);
      if (
        !notification ||
        notification.onboardingId !== eventHint.aggregateId ||
        notification.notificationType !== payload.category ||
        !onboarding ||
        !subjectStatus
      ) {
        reject("EVENT_BINDING_CONFLICT", "The reminder context does not match the event.");
      }
      if (
        runHint.status === AutomationRunStatus.COMPLETED &&
        eventHint.status === AutomationEventStatus.COMPLETED &&
        runHint.workerId === input.workerId &&
        runHint.idempotencyKey === input.idempotencyKey
      ) {
        return {
          replay: true as const,
          status: notification.status,
          providerReference: notification.providerReference,
        };
      }
      const binding = await requireCurrentAutomationRun(tx, {
        ...input,
        expectedEventType: "REMINDER_NOTIFICATION_REQUESTED",
      });
      if (
        reminderPolicyStopped({
          category: payload.category,
          onboardingStatus: onboarding.status,
          subjectStatus,
        })
      ) {
        await tx.notificationLog.update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.FAILED,
            failureReason: "Reminder suppressed because the underlying work is no longer due.",
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: notification.onboardingId,
          actorType: AuditActorType.SYSTEM,
          action: "REMINDER_NOTIFICATION_SUPPRESSED",
          entityType: "NOTIFICATION",
          entityId: notification.id,
          previousValue: { status: notification.status },
          newValue: { status: NotificationStatus.FAILED },
          metadata: { category: payload.category, policyWindow: payload.policyWindow },
          correlationId: binding.event.correlationId,
        });
        await completeBoundAutomationRun(tx, binding, {
          n8nExecutionId: input.n8nExecutionId,
          resultReferences: { notificationId: notification.id, suppressed: true },
        });
        return {
          replay: true as const,
          status: NotificationStatus.FAILED,
          providerReference: null,
        };
      }
      const deliveryAttemptKey = `REMINDER_DELIVERY:${notification.id}:event-attempt:${eventHint.attemptCount}`;
      if (
        notification.status === NotificationStatus.SENDING &&
        notification.deliveryAttemptKey === deliveryAttemptKey
      ) {
        return { replay: false as const, binding, notification, payload, deliveryAttemptKey };
      }
      if (
        notification.status !== NotificationStatus.PENDING &&
        notification.status !== NotificationStatus.FAILED
      ) {
        reject(
          notification.status === NotificationStatus.DELIVERY_UNCERTAIN
            ? "EMAIL_DELIVERY_UNCERTAIN"
            : "EMAIL_DELIVERY_CONFLICT",
          "The reminder is not eligible for delivery.",
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
      return { replay: false as const, binding, notification, payload, deliveryAttemptKey };
    });
    if (prepared.replay) {
      return {
        status: prepared.status,
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
          expectedEventType: "REMINDER_NOTIFICATION_REQUESTED",
        });
        const current = await tx.notificationLog.findUniqueOrThrow({
          where: { id: prepared.notification.id },
        });
        if (
          current.status !== NotificationStatus.SENDING ||
          current.deliveryAttemptKey !== prepared.deliveryAttemptKey
        ) {
          reject("EMAIL_DELIVERY_CONFLICT", "The reminder delivery attempt changed.");
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
        await appendAuditEvent(tx, {
          onboardingId: current.onboardingId,
          actorType: AuditActorType.SYSTEM,
          action:
            prepared.payload.policyWindow.includes("ESCALATE") ||
            prepared.payload.policyWindow.includes("FINAL")
              ? "REMINDER_ESCALATION_SENT"
              : "REMINDER_NOTIFICATION_SENT",
          entityType: "NOTIFICATION",
          entityId: current.id,
          previousValue: { status: NotificationStatus.SENDING },
          newValue: { status: NotificationStatus.SENT },
          metadata: {
            category: prepared.payload.category,
            policyWindow: prepared.payload.policyWindow,
          },
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
          expectedEventType: "REMINDER_NOTIFICATION_REQUESTED",
        });
        const message = "SMTP delivery outcome could not be confirmed.";
        await tx.notificationLog.update({
          where: { id: prepared.notification.id },
          data: {
            status: NotificationStatus.DELIVERY_UNCERTAIN,
            failureReason: message,
          },
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

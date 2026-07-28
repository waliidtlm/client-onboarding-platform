import {
  AuditActorType,
  AutomationEventStatus,
  AutomationFailureClassification,
  AutomationRunStatus,
  NotificationChannel,
  NotificationStatus,
  OnboardingStatus,
  Prisma,
  Role,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { appendWelcomeEmailRequestedEvent } from "@/application/automation/event-service";
import { requireCurrentAutomationRun } from "@/application/automation/binding";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
} from "@/application/commercial/service-support";
import {
  approveInternalReadinessSchema,
  beginWelcomeDeliverySchema,
  recordWelcomeDeliverySchema,
  resolveWelcomeUncertaintySchema,
} from "@/application/provisioning/contracts";
import { calculateProvisioningReadiness } from "@/domain/provisioning/readiness";
import { welcomeEmailDeduplicationKey, welcomeMessageKey } from "@/domain/provisioning/idempotency";
import { retryAvailableAt } from "@/domain/automation/retry-policy";
import { sanitizeAutomationError } from "@/lib/automation/error-sanitizer";
import { getServerEnvironment } from "@/lib/env";
import type { Result } from "@/domain/errors";

const TEMPLATE_VERSION = 1;
const SENDER_KEY = "NORTHSTAR_WELCOME_V1";
const SENDER_NAME = "Northstar Growth Agency";
const SENDER_ADDRESS = "welcome@northstar.test";

export type InternalReadinessApprovalResult = Readonly<{
  onboardingId: string;
  version: number;
  notificationId: string;
  eventId: string;
  idempotent: boolean;
}>;

export async function approveInternalReadiness(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<InternalReadinessApprovalResult>> {
  return executeService(async () => {
    const input = parseInput(approveInternalReadinessSchema.safeParse(rawInput));
    const environment = getServerEnvironment();
    return database.$transaction(
      async (tx) => {
        const actor = await requireActor(tx, input.actorId, [Role.ADMIN, Role.PROJECT_MANAGER]);
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${input.onboardingId}::uuid
          FOR UPDATE
        `);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
          include: {
            client: true,
            projectManager: true,
            provisioningTasks: true,
          },
        });
        if (
          !onboarding?.client ||
          !onboarding.projectManager ||
          !onboarding.servicePackageNameSnapshot
        ) {
          reject("MISSING_BUSINESS_CONFIGURATION", "Welcome-email context is incomplete.");
        }
        const deduplicationKey = welcomeEmailDeduplicationKey(onboarding.id);
        if (onboarding.internalReadinessApprovedAt) {
          const [notification, event] = await Promise.all([
            tx.notificationLog.findUnique({ where: { idempotencyKey: deduplicationKey } }),
            tx.automationEvent.findUnique({ where: { deduplicationKey } }),
          ]);
          if (!notification || !event)
            reject("CONFIGURATION_ERROR", "The approval ledger is incomplete.");
          return {
            onboardingId: onboarding.id,
            version: onboarding.version,
            notificationId: notification.id,
            eventId: event.id,
            idempotent: true,
          };
        }
        if (actor.role === Role.PROJECT_MANAGER && onboarding.projectManagerId !== actor.id) {
          reject("ACCESS_DENIED", "Only the assigned Project Manager may approve readiness.");
        }
        if (
          onboarding.status !== OnboardingStatus.INTERNAL_REVIEW ||
          onboarding.version !== input.expectedVersion ||
          onboarding.welcomeEmailSentAt
        ) {
          reject("VERSION_CONFLICT", "The onboarding is not in the expected review state.");
        }
        const readiness = calculateProvisioningReadiness(onboarding.provisioningTasks);
        if (
          !readiness.ready ||
          onboarding.provisioningTasks.some((task) => task.status === "IN_PROGRESS")
        ) {
          reject("INVALID_TRANSITION", "Required provisioning is not ready.");
        }
        const subject = `Welcome to ${SENDER_NAME} - ${onboarding.servicePackageNameSnapshot}`;
        const textContent = [
          `Hello ${onboarding.client.contactName},`,
          "",
          `Welcome to ${SENDER_NAME}. ${onboarding.projectManager.name} is your Project Manager for the ${onboarding.servicePackageNameSnapshot} package.`,
          "",
          "Our internal setup is ready. We will send separate secure requirement-access instructions when that part of onboarding is available.",
          "",
          "No action link is included in this welcome message.",
        ].join("\n");
        const notification = await tx.notificationLog.create({
          data: {
            onboardingId: onboarding.id,
            notificationType: "WELCOME_EMAIL",
            recipient: onboarding.client.contactEmail,
            channel: NotificationChannel.EMAIL,
            status: NotificationStatus.PENDING,
            idempotencyKey: deduplicationKey,
            senderKey: SENDER_KEY,
            senderName: SENDER_NAME,
            senderAddress: SENDER_ADDRESS,
            subject,
            textContent,
            htmlContent: null,
            templateVersion: TEMPLATE_VERSION,
            messageKey: welcomeMessageKey(onboarding.id),
          },
        });
        const now = new Date();
        const event = await appendWelcomeEmailRequestedEvent(tx, {
          onboardingId: onboarding.id,
          notificationId: notification.id,
          correlationId: input.correlationId,
          occurredAt: now,
          maxAttempts: environment.AUTOMATION_MAX_ATTEMPTS,
        });
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: {
            internalReadinessApprovedById: actor.id,
            internalReadinessApprovedAt: now,
            internalReadinessNote: input.note,
            version: { increment: 1 },
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: actor.id,
          action: "INTERNAL_READINESS_APPROVED",
          entityType: "ONBOARDING",
          entityId: onboarding.id,
          previousValue: { status: onboarding.status },
          newValue: { status: onboarding.status, approvalRecorded: true },
          metadata: { notificationId: notification.id, eventId: event.eventId },
          correlationId: input.correlationId,
        });
        return {
          onboardingId: onboarding.id,
          version: onboarding.version + 1,
          notificationId: notification.id,
          eventId: event.eventId,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function beginWelcomeEmailDelivery(
  rawInput: unknown,
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const input = parseInput(beginWelcomeDeliverySchema.safeParse(rawInput));
    return database.$transaction(async (tx) => {
      const binding = await requireCurrentAutomationRun(tx, {
        ...input,
        expectedEventType: "WELCOME_EMAIL_REQUESTED",
      });
      if (binding.payload.notificationId !== input.notificationId) {
        reject("EVENT_BINDING_CONFLICT", "The event does not identify this notification.");
      }
      const notification = await tx.notificationLog.findUnique({
        where: { id: input.notificationId },
      });
      if (!notification || notification.onboardingId !== binding.event.aggregateId) {
        reject("EVENT_BINDING_CONFLICT", "The notification and event do not match.");
      }
      const deliveryAttemptKey = `WELCOME_DELIVERY:${notification.id}:event-attempt:${binding.event.attemptCount}`;
      if (
        notification.status === NotificationStatus.SENDING &&
        notification.deliveryAttemptKey === deliveryAttemptKey
      ) {
        return { instruction: "SEND" as const, ...frozenDelivery(notification) };
      }
      if (
        notification.status !== NotificationStatus.PENDING &&
        notification.status !== NotificationStatus.FAILED
      ) {
        reject(
          notification.status === NotificationStatus.DELIVERY_UNCERTAIN
            ? "EMAIL_DELIVERY_UNCERTAIN"
            : "EMAIL_DELIVERY_CONFLICT",
          "The notification is not eligible to begin delivery.",
        );
      }
      const updated = await tx.notificationLog.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.SENDING,
          attemptCount: { increment: 1 },
          deliveryAttemptKey,
          deliveryStartedAt: binding.now,
          failureReason: null,
        },
      });
      return { instruction: "SEND" as const, ...frozenDelivery(updated) };
    });
  });
}

function frozenDelivery(notification: {
  id: string;
  recipient: string;
  senderName: string;
  senderAddress: string;
  subject: string;
  textContent: string;
  htmlContent: string | null;
  messageKey: string;
  deliveryAttemptKey: string | null;
}) {
  return {
    notificationId: notification.id,
    recipient: notification.recipient,
    senderName: notification.senderName,
    senderAddress: notification.senderAddress,
    subject: notification.subject,
    textContent: notification.textContent,
    htmlContent: notification.htmlContent,
    messageKey: notification.messageKey,
    deliveryAttemptKey: notification.deliveryAttemptKey!,
  };
}

export async function recordWelcomeEmailResult(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(recordWelcomeDeliverySchema.safeParse(rawInput));
    const environment = getServerEnvironment();
    const safeError = input.errorMessage ? sanitizeAutomationError(input.errorMessage) : null;
    return database.$transaction(
      async (tx) => {
        const replay = await loadWelcomeResultReplay(tx, input);
        if (replay) return replay;
        const binding = await requireCurrentAutomationRun(tx, {
          ...input,
          expectedEventType: "WELCOME_EMAIL_REQUESTED",
        });
        if (binding.payload.notificationId !== input.notificationId) {
          reject("EVENT_BINDING_CONFLICT", "The event does not identify this notification.");
        }
        const notification = await tx.notificationLog.findUnique({
          where: { id: input.notificationId },
        });
        const onboarding = await tx.onboarding.findUnique({
          where: { id: binding.event.aggregateId },
        });
        if (!notification || !onboarding || notification.onboardingId !== onboarding.id) {
          reject("EVENT_BINDING_CONFLICT", "The notification and onboarding do not match.");
        }
        if (notification.status !== NotificationStatus.SENDING) {
          reject("EMAIL_DELIVERY_CONFLICT", "No matching email delivery is active.");
        }
        if (input.outcome === "SENT") {
          if (!input.providerReference)
            reject("INVALID_INPUT", "A stable email reference is required.");
          if (onboarding.status !== OnboardingStatus.INTERNAL_REVIEW) {
            reject("INVALID_TRANSITION", "The onboarding is no longer awaiting the welcome email.");
          }
          await tx.notificationLog.update({
            where: { id: notification.id },
            data: {
              status: NotificationStatus.SENT,
              providerReference: input.providerReference,
              sentAt: binding.now,
              failureReason: null,
            },
          });
          await tx.onboarding.update({
            where: { id: onboarding.id },
            data: {
              status: OnboardingStatus.CLIENT_AWAITING_ACTION,
              welcomeEmailSentAt: binding.now,
              version: { increment: 1 },
            },
          });
          await appendAuditEvent(tx, {
            onboardingId: onboarding.id,
            actorType: AuditActorType.SYSTEM,
            action: "WELCOME_EMAIL_SENT",
            entityType: "NOTIFICATION",
            entityId: notification.id,
            previousValue: { status: notification.status },
            newValue: {
              status: NotificationStatus.SENT,
              providerReference: input.providerReference,
            },
            metadata: { messageKey: notification.messageKey },
            correlationId: binding.event.correlationId,
          });
          await tx.automationRun.update({
            where: { id: binding.run.id },
            data: {
              status: AutomationRunStatus.COMPLETED,
              completedAt: binding.now,
              n8nExecutionId: input.n8nExecutionId,
              resultReferences: {
                notificationId: notification.id,
                providerReference: input.providerReference,
              },
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
          return { status: NotificationStatus.SENT, idempotent: false };
        }

        const uncertain = input.outcome === "DELIVERY_UNCERTAIN";
        const eventStatus =
          uncertain || !input.retryable || binding.event.attemptCount >= binding.event.maxAttempts
            ? AutomationEventStatus.FAILED
            : AutomationEventStatus.PENDING;
        await tx.notificationLog.update({
          where: { id: notification.id },
          data: {
            status: uncertain ? NotificationStatus.DELIVERY_UNCERTAIN : NotificationStatus.FAILED,
            failureReason: safeError,
          },
        });
        await tx.automationRun.update({
          where: { id: binding.run.id },
          data: {
            status: AutomationRunStatus.FAILED,
            completedAt: binding.now,
            n8nExecutionId: input.n8nExecutionId,
            errorCode:
              input.errorCode || (uncertain ? "EMAIL_DELIVERY_UNCERTAIN" : "EMAIL_REJECTED"),
            errorMessage: safeError,
            failedNode: "Welcome email delivery",
            failureClassification: uncertain
              ? AutomationFailureClassification.OPERATOR_REMEDIABLE
              : input.retryable
                ? AutomationFailureClassification.RETRYABLE
                : AutomationFailureClassification.OPERATOR_REMEDIABLE,
            failureReportedAt: binding.now,
          },
        });
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
            lastErrorCode: input.errorCode || "EMAIL_DELIVERY_UNCERTAIN",
            lastError: safeError,
          },
        });
        return {
          status: uncertain ? NotificationStatus.DELIVERY_UNCERTAIN : NotificationStatus.FAILED,
          eventStatus,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

async function loadWelcomeResultReplay(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    runId: string;
    idempotencyKey: string;
    workerId: string;
    n8nExecutionId: string;
    notificationId: string;
    outcome: "SENT" | "REJECTED" | "DELIVERY_UNCERTAIN";
    providerReference: string | null;
    errorCode: string;
    errorMessage: string;
  },
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "AutomationEvent"
    WHERE "id" = ${input.eventId}::uuid
    FOR UPDATE
  `);
  const [event, run, notification] = await Promise.all([
    tx.automationEvent.findUnique({ where: { id: input.eventId } }),
    tx.automationRun.findUnique({ where: { id: input.runId } }),
    tx.notificationLog.findUnique({ where: { id: input.notificationId } }),
  ]);
  if (!event || !run || !notification) return null;
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  if (
    event.eventType !== "WELCOME_EMAIL_REQUESTED" ||
    event.schemaVersion !== 1 ||
    event.aggregateType !== "ONBOARDING" ||
    event.aggregateId !== notification.onboardingId ||
    payload.notificationId !== notification.id ||
    run.automationEventId !== event.id ||
    run.idempotencyKey !== input.idempotencyKey ||
    run.workerId !== input.workerId
  ) {
    reject("EVENT_BINDING_CONFLICT", "The callback identifiers do not describe one delivery.");
  }
  if (run.status === AutomationRunStatus.PROCESSING) return null;
  if (
    input.outcome === "SENT" &&
    run.status === AutomationRunStatus.COMPLETED &&
    event.status === AutomationEventStatus.COMPLETED &&
    notification.status === NotificationStatus.SENT &&
    run.n8nExecutionId === input.n8nExecutionId &&
    notification.providerReference === input.providerReference
  ) {
    return { status: NotificationStatus.SENT, idempotent: true };
  }
  if (
    input.outcome !== "SENT" &&
    run.status === AutomationRunStatus.FAILED &&
    (event.status === AutomationEventStatus.PENDING ||
      event.status === AutomationEventStatus.PROCESSING ||
      event.status === AutomationEventStatus.FAILED) &&
    (notification.status === NotificationStatus.FAILED ||
      notification.status === NotificationStatus.DELIVERY_UNCERTAIN) &&
    run.n8nExecutionId === input.n8nExecutionId &&
    run.errorCode ===
      (input.errorCode ||
        (input.outcome === "DELIVERY_UNCERTAIN" ? "EMAIL_DELIVERY_UNCERTAIN" : "EMAIL_REJECTED"))
  ) {
    return {
      status: notification.status,
      eventStatus: event.status,
      idempotent: true,
    };
  }
  reject("EMAIL_DELIVERY_CONFLICT", "The callback conflicts with the recorded delivery result.");
}

export async function resolveWelcomeDeliveryUncertainty(
  rawInput: unknown,
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const input = parseInput(resolveWelcomeUncertaintySchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN]);
        const notification = await tx.notificationLog.findUnique({
          where: { id: input.notificationId },
        });
        if (!notification || notification.status !== NotificationStatus.DELIVERY_UNCERTAIN) {
          reject(
            "EMAIL_DELIVERY_CONFLICT",
            "The notification is not awaiting uncertainty resolution.",
          );
        }
        const onboarding = await tx.onboarding.findUniqueOrThrow({
          where: { id: notification.onboardingId },
        });
        const event = await tx.automationEvent.findUnique({
          where: { deduplicationKey: notification.idempotencyKey },
        });
        if (!event || event.status !== AutomationEventStatus.FAILED || event.currentRunId) {
          reject("AUTOMATION_EVENT_CONFLICT", "The welcome event is not available for resolution.");
        }
        const now = new Date();
        if (input.action === "CONFIRM_SENT") {
          const providerReference =
            input.providerReference ?? notification.providerReference ?? notification.messageKey;
          await tx.notificationLog.update({
            where: { id: notification.id },
            data: {
              status: NotificationStatus.SENT,
              providerReference,
              sentAt: now,
              failureReason: null,
            },
          });
          await tx.onboarding.update({
            where: { id: onboarding.id },
            data: {
              status: OnboardingStatus.CLIENT_AWAITING_ACTION,
              welcomeEmailSentAt: onboarding.welcomeEmailSentAt ?? now,
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
              resolutionCode: "DELIVERY_CONFIRMED_SENT",
            },
          });
        } else {
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
            input.action === "CONFIRM_SENT"
              ? "WELCOME_EMAIL_DELIVERY_CONFIRMED"
              : "WELCOME_EMAIL_RESEND_AUTHORIZED",
          entityType: "NOTIFICATION",
          entityId: notification.id,
          previousValue: {
            status: notification.status,
            deliveryAttemptKey: notification.deliveryAttemptKey,
          },
          newValue: {
            status:
              input.action === "CONFIRM_SENT" ? NotificationStatus.SENT : NotificationStatus.FAILED,
          },
          metadata: { reason: input.reason },
          correlationId: input.correlationId,
        });
        return { action: input.action, eventId: event.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

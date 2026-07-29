import nodemailer from "nodemailer";

import {
  AuditActorType,
  AutomationEventStatus,
  AutomationFailureClassification,
  AutomationRunStatus,
  NotificationStatus,
  OnboardingStatus,
  Prisma,
  Role,
  type PrismaClient,
} from "@/generated/prisma/client";
import { appendAuditEvent } from "@/application/commercial/audit";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
} from "@/application/commercial/service-support";
import { resolveClientAccessEmailSchema } from "@/application/client-access/contracts";
import { requireCurrentAutomationRun } from "@/application/automation/binding";
import { deliverClientAccessEmailSchema } from "@/application/provisioning/contracts";
import { reconstructCapabilityToken } from "@/domain/client-access/token";
import type { Result } from "@/domain/errors";
import { prisma } from "@/lib/database";
import { clientAccessSigningKey } from "@/lib/client-access/keys";
import { getServerEnvironment } from "@/lib/env";

const ACCESS_LINK_PLACEHOLDER = "{{CLIENT_ACCESS_LINK}}";

async function lockEventOnboarding(tx: Prisma.TransactionClient, eventId: string): Promise<void> {
  const event = await tx.automationEvent.findUnique({
    where: { id: eventId },
    select: { aggregateId: true },
  });
  if (!event) reject("NOT_FOUND", "The automation event does not exist.");
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Onboarding"
    WHERE "id" = ${event.aggregateId}::uuid
    FOR UPDATE
  `);
}

async function setInitialDueDates(
  tx: Prisma.TransactionClient,
  onboardingId: string,
  deliveredAt: Date,
): Promise<boolean> {
  const onboarding = await tx.onboarding.findUniqueOrThrow({ where: { id: onboardingId } });
  if (onboarding.clientAccessDeliveredAt) return false;
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ClientRequirement"
    SET
      "dueAt" = ${deliveredAt}::timestamptz + ("dueOffsetDays" * INTERVAL '1 day'),
      "version" = "version" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "onboardingId" = ${onboardingId}::uuid
      AND "dueAt" IS NULL
  `);
  await tx.onboarding.update({
    where: { id: onboardingId },
    data: {
      clientAccessDeliveredAt: deliveredAt,
      version: { increment: 1 },
    },
  });
  return true;
}

async function failBeforeSmtp(
  database: PrismaClient,
  input: {
    eventId: string;
    runId: string;
    idempotencyKey: string;
    workerId: string;
    n8nExecutionId: string;
  },
  notificationId: string,
  errorCode: string,
  message: string,
) {
  await database.$transaction(async (tx) => {
    await lockEventOnboarding(tx, input.eventId);
    const binding = await requireCurrentAutomationRun(tx, {
      ...input,
      expectedEventType: "CLIENT_ACCESS_EMAIL_REQUESTED",
    });
    await tx.notificationLog.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.FAILED, failureReason: message },
    });
    await tx.automationRun.update({
      where: { id: binding.run.id },
      data: {
        status: AutomationRunStatus.FAILED,
        completedAt: binding.now,
        n8nExecutionId: input.n8nExecutionId,
        errorCode,
        errorMessage: message,
        failedNode: "Application access-email delivery",
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
        lastErrorCode: errorCode,
        lastError: message,
      },
    });
  });
}

export async function deliverClientAccessEmail(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<Readonly<{ status: string; providerReference?: string; idempotent: boolean }>>> {
  return executeService(async () => {
    const input = parseInput(deliverClientAccessEmailSchema.safeParse(rawInput));
    const prepared = await database.$transaction(async (tx) => {
      const completedRun = await tx.automationRun.findUnique({ where: { id: input.runId } });
      if (
        completedRun?.status === AutomationRunStatus.COMPLETED &&
        completedRun.automationEventId === input.eventId &&
        completedRun.idempotencyKey === input.idempotencyKey &&
        completedRun.workerId === input.workerId
      ) {
        return {
          replay: true as const,
          providerReference:
            completedRun.resultReferences &&
            typeof completedRun.resultReferences === "object" &&
            !Array.isArray(completedRun.resultReferences) &&
            typeof (completedRun.resultReferences as Record<string, unknown>).providerReference ===
              "string"
              ? ((completedRun.resultReferences as Record<string, string>).providerReference ?? "")
              : "",
        };
      }
      await lockEventOnboarding(tx, input.eventId);
      const binding = await requireCurrentAutomationRun(tx, {
        ...input,
        expectedEventType: "CLIENT_ACCESS_EMAIL_REQUESTED",
      });
      const notificationId = binding.payload.notificationId;
      if (!notificationId) {
        reject("EVENT_BINDING_CONFLICT", "The access-email event payload is incomplete.");
      }
      const notification = await tx.notificationLog.findUnique({
        where: { id: notificationId },
        include: { clientAccessToken: true, onboarding: true },
      });
      if (
        !notification?.clientAccessToken ||
        notification.onboardingId !== binding.event.aggregateId
      ) {
        reject("EVENT_BINDING_CONFLICT", "The access-email event is not bound correctly.");
      }
      if (
        notification.onboarding.status === OnboardingStatus.CANCELLED ||
        notification.clientAccessToken.revokedAt ||
        notification.clientAccessToken.expiresAt <= binding.now
      ) {
        reject("INVALID_TRANSITION", "Secure client access is no longer deliverable.");
      }
      const deliveryAttemptKey = `CLIENT_ACCESS_DELIVERY:${notification.id}:event-attempt:${binding.event.attemptCount}`;
      if (
        notification.status === NotificationStatus.SENDING &&
        notification.deliveryAttemptKey === deliveryAttemptKey
      ) {
        return {
          replay: false as const,
          binding,
          notification,
          deliveryAttemptKey,
        };
      }
      if (
        notification.status !== NotificationStatus.PENDING &&
        notification.status !== NotificationStatus.FAILED
      ) {
        reject(
          notification.status === NotificationStatus.DELIVERY_UNCERTAIN
            ? "EMAIL_DELIVERY_UNCERTAIN"
            : "EMAIL_DELIVERY_CONFLICT",
          "The notification is not eligible for delivery.",
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
    const notification = prepared.notification;
    const clientAccessToken = notification.clientAccessToken!;
    const signingKey = clientAccessSigningKey(clientAccessToken.signingKeyVersion);
    if (!signingKey) {
      await failBeforeSmtp(
        database,
        input,
        notification.id,
        "CLIENT_ACCESS_SIGNING_KEY_UNAVAILABLE",
        "The signing key required for this frozen access link is unavailable.",
      );
      return { status: NotificationStatus.FAILED, idempotent: false };
    }
    const rawToken = reconstructCapabilityToken(clientAccessToken, signingKey);
    const expectedHash = clientAccessToken.tokenHash;
    const reconstructedHash = (await import("node:crypto"))
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    if (reconstructedHash !== expectedHash) {
      await failBeforeSmtp(
        database,
        input,
        notification.id,
        "CLIENT_ACCESS_TOKEN_RECONSTRUCTION_FAILED",
        "The frozen access capability could not be reconstructed.",
      );
      return { status: NotificationStatus.FAILED, idempotent: false };
    }
    const fragment = notification.fragmentFormatSnapshot!.replace("{token}", rawToken);
    const link = `${notification.publicBaseUrlSnapshot}${fragment}`;
    const text = notification.textContent.replace(ACCESS_LINK_PLACEHOLDER, link);
    const environment = getServerEnvironment();
    try {
      const transport = nodemailer.createTransport({
        host: environment.SMTP_HOST,
        port: environment.SMTP_PORT,
        secure: false,
      });
      const sent = await transport.sendMail({
        from: {
          name: notification.senderName,
          address: notification.senderAddress,
        },
        to: notification.recipient,
        subject: notification.subject,
        text,
        headers: {
          "X-Notification-Key": notification.messageKey,
        },
      });
      const providerReference = sent.messageId || notification.messageKey;
      await database.$transaction(async (tx) => {
        await lockEventOnboarding(tx, input.eventId);
        const binding = await requireCurrentAutomationRun(tx, {
          ...input,
          expectedEventType: "CLIENT_ACCESS_EMAIL_REQUESTED",
        });
        const current = await tx.notificationLog.findUniqueOrThrow({
          where: { id: notification.id },
        });
        if (
          current.status !== NotificationStatus.SENDING ||
          current.deliveryAttemptKey !== prepared.deliveryAttemptKey
        ) {
          reject("EMAIL_DELIVERY_CONFLICT", "The access-email attempt changed.");
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
        const currentOnboarding = await tx.onboarding.findUniqueOrThrow({
          where: { id: current.onboardingId },
        });
        const datesInitialized =
          currentOnboarding.status === OnboardingStatus.CANCELLED
            ? false
            : await setInitialDueDates(tx, current.onboardingId, binding.now);
        await appendAuditEvent(tx, {
          onboardingId: current.onboardingId,
          actorType: AuditActorType.SYSTEM,
          action: "CLIENT_ACCESS_EMAIL_SENT",
          entityType: "NOTIFICATION",
          entityId: current.id,
          previousValue: { status: NotificationStatus.SENDING },
          newValue: {
            status: NotificationStatus.SENT,
            dueDatesInitialized: datesInitialized,
          },
          metadata: { messageKey: current.messageKey },
          correlationId: binding.event.correlationId,
        });
        await tx.automationRun.update({
          where: { id: binding.run.id },
          data: {
            status: AutomationRunStatus.COMPLETED,
            completedAt: binding.now,
            n8nExecutionId: input.n8nExecutionId,
            resultReferences: { notificationId: current.id, providerReference },
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
      });
      return {
        status: NotificationStatus.SENT,
        providerReference,
        idempotent: false,
      };
    } catch {
      await database.$transaction(async (tx) => {
        await lockEventOnboarding(tx, input.eventId);
        const binding = await requireCurrentAutomationRun(tx, {
          ...input,
          expectedEventType: "CLIENT_ACCESS_EMAIL_REQUESTED",
        });
        const message = "SMTP delivery outcome could not be confirmed.";
        await tx.notificationLog.update({
          where: { id: notification.id },
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
    } finally {
      // The bearer and link remain local variables only and are never logged or returned.
    }
  });
}

export async function resolveClientAccessEmailUncertainty(
  rawInput: unknown,
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const input = parseInput(resolveClientAccessEmailSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN]);
        const notification = await tx.notificationLog.findUnique({
          where: { id: input.notificationId },
        });
        if (
          !notification?.clientAccessTokenId ||
          notification.status !== NotificationStatus.DELIVERY_UNCERTAIN
        ) {
          reject("EMAIL_DELIVERY_CONFLICT", "The access email is not awaiting resolution.");
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${notification.onboardingId}::uuid
          FOR UPDATE
        `);
        const onboarding = await tx.onboarding.findUniqueOrThrow({
          where: { id: notification.onboardingId },
        });
        if (onboarding.status === OnboardingStatus.CANCELLED) {
          reject("INVALID_TRANSITION", "Cancelled onboarding email cannot be retried.");
        }
        const event = await tx.automationEvent.findUnique({
          where: { deduplicationKey: notification.idempotencyKey },
        });
        if (!event || event.status !== AutomationEventStatus.FAILED || event.currentRunId) {
          reject("AUTOMATION_EVENT_CONFLICT", "The access-email event is not resolvable.");
        }
        const clock = await tx.$queryRaw<Array<{ now: Date }>>(
          Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
        );
        const now = clock[0]!.now;
        let datesInitialized = false;
        if (input.action === "CONFIRM_SENT") {
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
          datesInitialized = await setInitialDueDates(tx, onboarding.id, now);
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
              ? "CLIENT_ACCESS_EMAIL_DELIVERY_CONFIRMED"
              : "CLIENT_ACCESS_EMAIL_RESEND_AUTHORIZED",
          entityType: "NOTIFICATION",
          entityId: notification.id,
          previousValue: { status: NotificationStatus.DELIVERY_UNCERTAIN },
          newValue: {
            status:
              input.action === "CONFIRM_SENT" ? NotificationStatus.SENT : NotificationStatus.FAILED,
            dueDatesInitialized: datesInitialized,
          },
          metadata: { reasonProvided: true },
          correlationId: input.correlationId,
        });
        return { action: input.action, eventId: event.id, datesInitialized };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

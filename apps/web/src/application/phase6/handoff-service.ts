import {
  AuditActorType,
  DeliveryHandoffStatus,
  NotificationChannel,
  NotificationStatus,
  OnboardingStatus,
  Prisma,
  Role,
  SlaResult,
  type PrismaClient,
} from "@/generated/prisma/client";

import { appendAuditEvent } from "@/application/commercial/audit";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
  type TransactionClient,
} from "@/application/commercial/service-support";
import {
  acknowledgeHandoffSchema,
  markHandoffReadySchema,
  reassignHandoffSchema,
  saveHandoffDraftSchema,
} from "@/application/phase6/contracts";
import { buildHandoffSourceSnapshot } from "@/application/phase6/kickoff-service";
import { HANDOFF_SUMMARY_SCHEMA_VERSION } from "@/domain/phase6/handoff";
import {
  deliveryHandoffNotificationKey,
  phase6EventKey,
  phase6Fingerprint,
} from "@/domain/phase6/idempotency";
import { calculateSlaResult } from "@/domain/phase6/sla";
import { prisma } from "@/lib/database";
import { getServerEnvironment } from "@/lib/env";

const SENDER_NAME = "Northstar Growth Agency";
const SENDER_ADDRESS = "delivery@northstar.test";
const SENDER_KEY = "NORTHSTAR_PHASE6_V1";

async function lockOnboarding(tx: TransactionClient, onboardingId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Onboarding" WHERE "id" = ${onboardingId}::uuid FOR UPDATE
  `);
}

async function authorizedHandoff(
  tx: TransactionClient,
  actorId: string,
  onboardingId: string,
  allowedRoles: readonly Role[] = [Role.ADMIN, Role.PROJECT_MANAGER],
) {
  const actor = await requireActor(tx, actorId, allowedRoles);
  await lockOnboarding(tx, onboardingId);
  const onboarding = await tx.onboarding.findUnique({
    where: { id: onboardingId },
    include: {
      client: true,
      projectManager: true,
      kickoff: true,
      deliveryHandoff: { include: { assignedDeliveryUser: true } },
    },
  });
  if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
  if (
    actor.role === Role.PROJECT_MANAGER &&
    (onboarding.projectManagerId !== actor.id || !onboarding.projectManager?.isActive)
  ) {
    reject("ACCESS_DENIED", "Only the assigned active Project Manager may manage handoff.");
  }
  return { actor, onboarding };
}

async function requireActiveDelivery(tx: TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId } });
  if (!user?.isActive || user.role !== Role.DELIVERY) {
    reject("INVALID_INPUT", "Assign an active Delivery user.");
  }
  return user;
}

function editableText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

export async function saveDeliveryHandoffDraft(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(saveHandoffDraftSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const { actor, onboarding } = await authorizedHandoff(
          tx,
          input.actorId,
          input.onboardingId,
        );
        const handoff = onboarding.deliveryHandoff;
        if (
          !handoff ||
          onboarding.status !== OnboardingStatus.PROJECT_READY ||
          handoff.status !== DeliveryHandoffStatus.DRAFT ||
          handoff.version !== input.expectedHandoffVersion
        ) {
          reject("VERSION_CONFLICT", "The handoff draft changed or is no longer editable.");
        }
        if (input.assignedDeliveryId) await requireActiveDelivery(tx, input.assignedDeliveryId);
        const updated = await tx.deliveryHandoff.update({
          where: { id: handoff.id },
          data: {
            preparedById: actor.id,
            assignedDeliveryUserId: input.assignedDeliveryId,
            summary: editableText(input.summary),
            riskNotes: editableText(input.riskNotes),
            nextActions: editableText(input.nextActions),
            preparedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: actor.id,
          action: "DELIVERY_HANDOFF_DRAFT_SAVED",
          entityType: "DELIVERY_HANDOFF",
          entityId: handoff.id,
          previousValue: { assignedDeliveryUserId: handoff.assignedDeliveryUserId },
          newValue: { assignedDeliveryUserId: updated.assignedDeliveryUserId },
          correlationId: input.correlationId,
        });
        return { handoffId: handoff.id, version: updated.version };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

async function createHandoffNotification(
  tx: TransactionClient,
  input: Readonly<{
    onboarding: Awaited<ReturnType<typeof authorizedHandoff>>["onboarding"];
    handoffId: string;
    assignmentRevision: number;
    assignedDeliveryId: string;
    idempotencyKey: string;
    fingerprint: string;
    correlationId: string;
    now: Date;
  }>,
) {
  const recipient = await requireActiveDelivery(tx, input.assignedDeliveryId);
  const notification = await tx.notificationLog.create({
    data: {
      onboardingId: input.onboarding.id,
      deliveryHandoffId: input.handoffId,
      notificationType: "DELIVERY_HANDOFF_NOTIFICATION",
      recipient: recipient.email,
      channel: NotificationChannel.EMAIL,
      status: NotificationStatus.PENDING,
      idempotencyKey: input.idempotencyKey,
      senderKey: SENDER_KEY,
      senderName: SENDER_NAME,
      senderAddress: SENDER_ADDRESS,
      subject: `Delivery handoff ready — ${input.onboarding.client?.companyName ?? "client"}`,
      textContent: [
        `Hello ${recipient.name},`,
        "",
        `A delivery handoff is ready for ${input.onboarding.client?.companyName ?? "the client"}.`,
        "Open the onboarding platform to review and acknowledge it.",
      ].join("\n"),
      htmlContent: null,
      templateVersion: 1,
      messageKey: deliveryHandoffNotificationKey(input.handoffId, input.assignmentRevision),
      businessRevision: input.assignmentRevision,
      requestFingerprint: input.fingerprint,
    },
  });
  const event = await tx.automationEvent.create({
    data: {
      eventType: "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED",
      aggregateType: "ONBOARDING",
      aggregateId: input.onboarding.id,
      payload: { notificationId: notification.id },
      schemaVersion: 1,
      maxAttempts: getServerEnvironment().AUTOMATION_MAX_ATTEMPTS,
      availableAt: input.now,
      occurredAt: input.now,
      correlationId: input.correlationId,
      deduplicationKey: phase6EventKey(notification.id, "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED"),
    },
  });
  return { notification, event };
}

export async function markDeliveryHandoffReady(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(markHandoffReadySchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const { actor, onboarding } = await authorizedHandoff(
          tx,
          input.actorId,
          input.onboardingId,
        );
        const handoff = onboarding.deliveryHandoff;
        const fingerprint = phase6Fingerprint({
          operation: "MARK_READY",
          handoffId: handoff?.id,
          assignedDeliveryUserId: handoff?.assignedDeliveryUserId,
          expectedVersion: input.expectedHandoffVersion,
        });
        const replay = await tx.notificationLog.findUnique({
          where: {
            idempotencyKey: handoff
              ? `HANDOFF_READY:${handoff.id}:${input.idempotencyKey}`
              : `HANDOFF_READY:MISSING:${input.idempotencyKey}`,
          },
        });
        if (replay) {
          if (replay.requestFingerprint !== fingerprint)
            reject("VERSION_CONFLICT", "Idempotency key conflict.");
          return { handoffId: handoff!.id, notificationId: replay.id, idempotent: true };
        }
        if (
          !handoff ||
          onboarding.status !== OnboardingStatus.PROJECT_READY ||
          handoff.status !== DeliveryHandoffStatus.DRAFT ||
          handoff.version !== input.expectedHandoffVersion ||
          !handoff.assignedDeliveryUserId ||
          !handoff.summary ||
          handoff.summary.trim().length < 40
        ) {
          reject("VERSION_CONFLICT", "Complete and assign the current handoff draft first.");
        }
        await requireActiveDelivery(tx, handoff.assignedDeliveryUserId);
        const snapshot = await buildHandoffSourceSnapshot(
          tx,
          onboarding.id,
          onboarding.kickoff?.outcomeNotes ?? "",
        );
        const now = new Date();
        const revision = handoff.assignmentRevision + 1;
        const updated = await tx.deliveryHandoff.update({
          where: { id: handoff.id },
          data: {
            status: DeliveryHandoffStatus.READY,
            preparedById: actor.id,
            preparedAt: now,
            sourceSnapshot: snapshot.snapshot as Prisma.InputJsonObject,
            sourceFingerprint: snapshot.fingerprint,
            summarySchemaVersion: HANDOFF_SUMMARY_SCHEMA_VERSION,
            assignmentRevision: revision,
            version: { increment: 1 },
          },
        });
        const { notification, event } = await createHandoffNotification(tx, {
          onboarding,
          handoffId: handoff.id,
          assignmentRevision: revision,
          assignedDeliveryId: handoff.assignedDeliveryUserId,
          idempotencyKey: `HANDOFF_READY:${handoff.id}:${input.idempotencyKey}`,
          fingerprint,
          correlationId: input.correlationId,
          now,
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: actor.id,
          action: "DELIVERY_HANDOFF_READY",
          entityType: "DELIVERY_HANDOFF",
          entityId: handoff.id,
          previousValue: { status: handoff.status },
          newValue: { status: updated.status, assignmentRevision: revision },
          metadata: { notificationId: notification.id, eventId: event.id },
          correlationId: input.correlationId,
        });
        return { handoffId: handoff.id, notificationId: notification.id, idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function reassignDeliveryHandoff(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(reassignHandoffSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const { actor, onboarding } = await authorizedHandoff(
          tx,
          input.actorId,
          input.onboardingId,
        );
        const handoff = onboarding.deliveryHandoff;
        if (!handoff) {
          reject("VERSION_CONFLICT", "The handoff does not exist.");
        }
        const fingerprint = phase6Fingerprint({
          operation: "REASSIGN",
          assignedDeliveryId: input.assignedDeliveryId,
          reason: input.reason,
          expectedVersion: input.expectedHandoffVersion,
        });
        const idempotencyKey = `HANDOFF_REASSIGN:${handoff.id}:${input.idempotencyKey}`;
        const replay = await tx.notificationLog.findUnique({ where: { idempotencyKey } });
        if (replay) {
          if (replay.requestFingerprint !== fingerprint)
            reject("VERSION_CONFLICT", "Idempotency key conflict.");
          return { handoffId: handoff.id, notificationId: replay.id, idempotent: true };
        }
        if (
          handoff.version !== input.expectedHandoffVersion ||
          handoff.status === DeliveryHandoffStatus.DRAFT ||
          handoff.status === DeliveryHandoffStatus.ACKNOWLEDGED ||
          handoff.status === DeliveryHandoffStatus.CANCELLED
        ) {
          reject("VERSION_CONFLICT", "The handoff cannot be reassigned in its current state.");
        }
        const unresolved = await tx.notificationLog.findFirst({
          where: {
            deliveryHandoffId: handoff.id,
            status: { in: [NotificationStatus.SENDING, NotificationStatus.DELIVERY_UNCERTAIN] },
          },
        });
        if (unresolved)
          reject("EMAIL_DELIVERY_UNCERTAIN", "Resolve the active delivery attempt first.");
        await requireActiveDelivery(tx, input.assignedDeliveryId);
        const now = new Date();
        const revision = handoff.assignmentRevision + 1;
        const updated = await tx.deliveryHandoff.update({
          where: { id: handoff.id },
          data: {
            assignedDeliveryUserId: input.assignedDeliveryId,
            assignmentRevision: revision,
            status: DeliveryHandoffStatus.READY,
            version: { increment: 1 },
          },
        });
        let notificationId: string | null = null;
        const created = await createHandoffNotification(tx, {
          onboarding,
          handoffId: handoff.id,
          assignmentRevision: revision,
          assignedDeliveryId: input.assignedDeliveryId,
          idempotencyKey,
          fingerprint,
          correlationId: input.correlationId,
          now,
        });
        notificationId = created.notification.id;
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: actor.id,
          action: "DELIVERY_HANDOFF_REASSIGNED",
          entityType: "DELIVERY_HANDOFF",
          entityId: handoff.id,
          previousValue: { assignedDeliveryUserId: handoff.assignedDeliveryUserId },
          newValue: {
            assignedDeliveryUserId: input.assignedDeliveryId,
            assignmentRevision: revision,
          },
          metadata: { reason: input.reason, notificationId },
          correlationId: input.correlationId,
        });
        return {
          handoffId: handoff.id,
          version: updated.version,
          notificationId,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function acknowledgeDeliveryHandoff(
  rawInput: unknown,
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const input = parseInput(acknowledgeHandoffSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const { actor, onboarding } = await authorizedHandoff(
          tx,
          input.actorId,
          input.onboardingId,
          [Role.ADMIN, Role.DELIVERY],
        );
        const handoff = onboarding.deliveryHandoff;
        const fingerprint = phase6Fingerprint({
          onboardingId: input.onboardingId,
          expectedHandoffVersion: input.expectedHandoffVersion,
          expectedOnboardingVersion: input.expectedOnboardingVersion,
          adminExceptionReason: input.adminExceptionReason,
        });
        const acknowledgmentIdempotencyKey = handoff
          ? `HANDOFF_ACK:${handoff.id}:${input.idempotencyKey}`
          : null;
        if (
          handoff?.acknowledgmentIdempotencyKey === acknowledgmentIdempotencyKey &&
          handoff.acknowledgmentFingerprint === fingerprint &&
          handoff.status === DeliveryHandoffStatus.ACKNOWLEDGED
        ) {
          return { handoffId: handoff.id, onboardingId: onboarding.id, idempotent: true };
        }
        if (
          !handoff ||
          onboarding.status !== OnboardingStatus.PROJECT_READY ||
          onboarding.version !== input.expectedOnboardingVersion ||
          handoff.status !== DeliveryHandoffStatus.NOTIFIED ||
          handoff.version !== input.expectedHandoffVersion
        ) {
          reject("VERSION_CONFLICT", "The notified handoff changed. Refresh and try again.");
        }
        const adminException = actor.role === Role.ADMIN;
        if (adminException && !input.adminExceptionReason) {
          reject("INVALID_INPUT", "Admin acknowledgment requires an exception reason.");
        }
        if (!adminException && handoff.assignedDeliveryUserId !== actor.id) {
          reject("ACCESS_DENIED", "Only the assigned active Delivery user may acknowledge.");
        }
        const now = new Date();
        const sla = calculateSlaResult(
          onboarding.activatedAt,
          now,
          onboarding.slaTargetHoursSnapshot,
        );
        await tx.deliveryHandoff.update({
          where: { id: handoff.id },
          data: {
            status: DeliveryHandoffStatus.ACKNOWLEDGED,
            acknowledgedAt: now,
            acknowledgedById: actor.id,
            acknowledgmentIdempotencyKey,
            acknowledgmentFingerprint: fingerprint,
            acknowledgedAsAdminException: adminException,
            acknowledgmentExceptionReason: input.adminExceptionReason,
            version: { increment: 1 },
          },
        });
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: {
            status: OnboardingStatus.COMPLETED,
            completedAt: now,
            slaResult: sla as SlaResult,
            version: { increment: 1 },
          },
        });
        await tx.clientAccessToken.updateMany({
          where: { onboardingId: onboarding.id, revokedAt: null },
          data: { revokedAt: now, revocationReason: "ONBOARDING_COMPLETED" },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: actor.id,
          action: "ONBOARDING_COMPLETED",
          entityType: "ONBOARDING",
          entityId: onboarding.id,
          previousValue: { status: onboarding.status },
          newValue: { status: OnboardingStatus.COMPLETED, slaResult: sla },
          metadata: { handoffId: handoff.id, adminException },
          correlationId: input.correlationId,
        });
        return { handoffId: handoff.id, onboardingId: onboarding.id, idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

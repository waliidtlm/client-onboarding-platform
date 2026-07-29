import {
  AuditActorType,
  KickoffStatus,
  NotificationChannel,
  NotificationStatus,
  OnboardingStatus,
  Prisma,
  Role,
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
  requireActor,
  type TransactionClient,
} from "@/application/commercial/service-support";
import {
  completeKickoffSchema,
  machinePhase6RunSchema,
  scheduleKickoffSchema,
  waiveKickoffInvitationSchema,
} from "@/application/phase6/contracts";
import { buildHandoffSnapshot, HANDOFF_SUMMARY_SCHEMA_VERSION } from "@/domain/phase6/handoff";
import {
  canCompleteKickoff,
  validateKickoffDestination,
  validOutcomeNotes,
} from "@/domain/phase6/kickoff";
import {
  kickoffInvitationKey,
  phase6EventKey,
  phase6Fingerprint,
} from "@/domain/phase6/idempotency";
import { resolveScheduleInstant, validateMeetingUrl } from "@/domain/phase6/time";
import { prisma } from "@/lib/database";
import { getServerEnvironment } from "@/lib/env";

const SENDER_NAME = "Northstar Growth Agency";
const SENDER_ADDRESS = "onboarding@northstar.test";
const SENDER_KEY = "NORTHSTAR_PHASE6_V1";

async function lockOnboarding(tx: TransactionClient, onboardingId: string) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "Onboarding" WHERE "id" = ${onboardingId}::uuid FOR UPDATE
  `);
}

async function authorizedKickoff(tx: TransactionClient, actorId: string, onboardingId: string) {
  const actor = await requireActor(tx, actorId, [Role.ADMIN, Role.PROJECT_MANAGER]);
  await lockOnboarding(tx, onboardingId);
  const onboarding = await tx.onboarding.findUnique({
    where: { id: onboardingId },
    include: { client: true, projectManager: true, kickoff: true },
  });
  if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
  if (!onboarding.client?.contactEmail) {
    reject("MISSING_BUSINESS_CONFIGURATION", "Client contact email is required for kickoff.");
  }
  if (
    actor.role === Role.PROJECT_MANAGER &&
    (onboarding.projectManagerId !== actor.id || !onboarding.projectManager?.isActive)
  ) {
    reject("ACCESS_DENIED", "Only the assigned active Project Manager may manage kickoff.");
  }
  return { actor, onboarding };
}

export async function initializeKickoffFromCompletionEvent(
  rawInput: unknown,
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const input = parseInput(machinePhase6RunSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const eventHint = await tx.automationEvent.findUnique({
          where: { id: input.eventId },
          select: { aggregateId: true },
        });
        if (!eventHint) reject("NOT_FOUND", "The automation event does not exist.");
        await lockOnboarding(tx, eventHint.aggregateId);
        const binding = await requireCurrentAutomationRun(tx, {
          ...input,
          expectedEventType: "CLIENT_REQUIREMENTS_COMPLETED",
        });
        const onboarding = await tx.onboarding.findUnique({
          where: { id: binding.event.aggregateId },
          include: { kickoff: true, clientRequirements: true },
        });
        if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");
        if (
          onboarding.status === OnboardingStatus.KICKOFF_PENDING &&
          onboarding.kickoff?.status === KickoffStatus.PENDING
        ) {
          await completeBoundAutomationRun(tx, binding, {
            n8nExecutionId: input.n8nExecutionId,
            resultReferences: { kickoffId: onboarding.kickoff.id, idempotent: true },
          });
          return { kickoffId: onboarding.kickoff.id, idempotent: true };
        }
        if (onboarding.status !== OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE) {
          reject("INVALID_TRANSITION", "The onboarding is not ready for kickoff initialization.");
        }
        const mandatory = onboarding.clientRequirements.filter(
          (requirement) => requirement.isRequired,
        );
        if (
          mandatory.length === 0 ||
          mandatory.some((requirement) => requirement.status !== "APPROVED")
        ) {
          reject("REQUIREMENT_CONFIGURATION_ERROR", "Mandatory requirements are not complete.");
        }
        const now = binding.now;
        const kickoff = await tx.kickoff.create({
          data: { onboardingId: onboarding.id, status: KickoffStatus.PENDING },
        });
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: { status: OnboardingStatus.KICKOFF_PENDING, version: { increment: 1 } },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.SYSTEM,
          action: "KICKOFF_CREATED",
          entityType: "KICKOFF",
          entityId: kickoff.id,
          previousValue: { status: OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE },
          newValue: { status: KickoffStatus.PENDING },
          metadata: { eventId: binding.event.id },
          correlationId: binding.event.correlationId,
        });
        await completeBoundAutomationRun(tx, binding, {
          n8nExecutionId: input.n8nExecutionId,
          resultReferences: { kickoffId: kickoff.id, initializedAt: now.toISOString() },
        });
        return { kickoffId: kickoff.id, idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function scheduleKickoff(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(scheduleKickoffSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const { actor, onboarding } = await authorizedKickoff(
          tx,
          input.actorId,
          input.onboardingId,
        );
        const kickoff = onboarding.kickoff;
        if (!kickoff || onboarding.status !== OnboardingStatus.KICKOFF_PENDING) {
          reject("INVALID_TRANSITION", "Kickoff is not available for scheduling.");
        }
        const fingerprint = phase6Fingerprint({
          localDate: input.localDate,
          localTime: input.localTime,
          timezone: input.timezone,
          ambiguityChoice: input.ambiguityChoice ?? null,
          meetingUrl: input.meetingUrl,
          meetingLocation: input.meetingLocation,
          reason: input.reason,
        });
        const replay = await tx.notificationLog.findUnique({
          where: { idempotencyKey: `KICKOFF_SCHEDULE:${kickoff.id}:${input.idempotencyKey}` },
        });
        if (replay) {
          if (replay.requestFingerprint !== fingerprint) {
            reject(
              "VERSION_CONFLICT",
              "That scheduling key was already used with different input.",
            );
          }
          return {
            kickoffId: kickoff.id,
            version: kickoff.version,
            notificationId: replay.id,
            idempotent: true,
          };
        }
        if (kickoff.version !== input.expectedKickoffVersion) {
          reject("VERSION_CONFLICT", "Kickoff changed. Refresh and try again.");
        }
        if (
          kickoff.status !== KickoffStatus.PENDING &&
          kickoff.status !== KickoffStatus.SCHEDULED &&
          kickoff.status !== KickoffStatus.CANCELLED
        ) {
          reject("INVALID_TRANSITION", "Completed kickoff cannot be rescheduled.");
        }
        if (kickoff.status !== KickoffStatus.PENDING && !input.reason) {
          reject("INVALID_INPUT", "A reason is required to reschedule kickoff.");
        }
        if (!validateMeetingUrl(input.meetingUrl)) {
          reject("INVALID_INPUT", "Meeting URL must be HTTPS and must not contain credentials.");
        }
        if (!validateKickoffDestination(input.meetingUrl, input.meetingLocation)) {
          reject("INVALID_INPUT", "Provide a meeting URL or location.");
        }
        const clock = await tx.$queryRaw<Array<{ now: Date }>>(
          Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
        );
        const resolution = resolveScheduleInstant({
          localDate: input.localDate,
          localTime: input.localTime,
          timezone: input.timezone,
          ...(input.ambiguityChoice ? { ambiguityChoice: input.ambiguityChoice } : {}),
          now: clock[0]!.now,
        });
        if (!resolution.ok) reject("INVALID_INPUT", resolution.message);
        const revision = kickoff.scheduleRevision + 1;
        const updated = await tx.kickoff.update({
          where: { id: kickoff.id },
          data: {
            status: KickoffStatus.SCHEDULED,
            scheduledStartAt: resolution.instant,
            timezone: input.timezone,
            meetingUrl: input.meetingUrl,
            meetingLocation: input.meetingLocation,
            scheduleRevision: revision,
            invitationWaivedAt: null,
            invitationWaivedById: null,
            invitationWaiverReason: null,
            invitationWaivedForRevision: null,
            cancelledAt: null,
            cancelledById: null,
            cancellationReason: null,
            version: { increment: 1 },
          },
        });
        const notification = await tx.notificationLog.create({
          data: {
            onboardingId: onboarding.id,
            kickoffId: kickoff.id,
            notificationType: "KICKOFF_INVITATION",
            recipient: onboarding.client?.contactEmail ?? "",
            channel: NotificationChannel.EMAIL,
            status: NotificationStatus.PENDING,
            idempotencyKey: `KICKOFF_SCHEDULE:${kickoff.id}:${input.idempotencyKey}`,
            senderKey: SENDER_KEY,
            senderName: SENDER_NAME,
            senderAddress: SENDER_ADDRESS,
            subject: `Kickoff invitation — ${onboarding.servicePackageNameSnapshot ?? "your project"}`,
            textContent: [
              `Hello ${onboarding.client?.contactName ?? "there"},`,
              "",
              `Your kickoff is scheduled for ${input.localDate} at ${input.localTime} (${input.timezone}).`,
              input.meetingUrl ? `Meeting: ${input.meetingUrl}` : "",
              input.meetingLocation ? `Location: ${input.meetingLocation}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            htmlContent: null,
            templateVersion: 1,
            messageKey: kickoffInvitationKey(kickoff.id, revision),
            businessRevision: revision,
            requestFingerprint: fingerprint,
          },
        });
        const environment = getServerEnvironment();
        const event = await tx.automationEvent.create({
          data: {
            eventType: "KICKOFF_INVITATION_REQUESTED",
            aggregateType: "ONBOARDING",
            aggregateId: onboarding.id,
            payload: { notificationId: notification.id },
            schemaVersion: 1,
            maxAttempts: environment.AUTOMATION_MAX_ATTEMPTS,
            occurredAt: clock[0]!.now,
            availableAt: clock[0]!.now,
            correlationId: input.correlationId,
            deduplicationKey: phase6EventKey(notification.id, "KICKOFF_INVITATION_REQUESTED"),
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: actor.id,
          action:
            kickoff.status === KickoffStatus.PENDING ? "KICKOFF_SCHEDULED" : "KICKOFF_RESCHEDULED",
          entityType: "KICKOFF",
          entityId: kickoff.id,
          previousValue: { status: kickoff.status, scheduleRevision: kickoff.scheduleRevision },
          newValue: { status: updated.status, scheduleRevision: revision },
          metadata: { eventId: event.id, reasonProvided: Boolean(input.reason) },
          correlationId: input.correlationId,
        });
        return {
          kickoffId: kickoff.id,
          version: updated.version,
          notificationId: notification.id,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function waiveKickoffInvitation(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(waiveKickoffInvitationSchema.safeParse(rawInput));
    return database.$transaction(async (tx) => {
      const { actor, onboarding } = await authorizedKickoff(tx, input.actorId, input.onboardingId);
      if (actor.role !== Role.ADMIN)
        reject("ACCESS_DENIED", "Only an Admin may waive invitation delivery.");
      const kickoff = onboarding.kickoff;
      if (
        !kickoff ||
        kickoff.status !== KickoffStatus.SCHEDULED ||
        kickoff.version !== input.expectedKickoffVersion
      ) {
        reject("VERSION_CONFLICT", "Kickoff is not in the expected scheduled state.");
      }
      const now = new Date();
      const updated = await tx.kickoff.update({
        where: { id: kickoff.id },
        data: {
          invitationWaivedAt: now,
          invitationWaivedById: actor.id,
          invitationWaiverReason: input.reason,
          invitationWaivedForRevision: kickoff.scheduleRevision,
          version: { increment: 1 },
        },
      });
      await appendAuditEvent(tx, {
        onboardingId: onboarding.id,
        actorType: AuditActorType.STAFF,
        actorId: actor.id,
        action: "KICKOFF_INVITATION_WAIVED",
        entityType: "KICKOFF",
        entityId: kickoff.id,
        newValue: { waived: true, scheduleRevision: kickoff.scheduleRevision },
        metadata: { reason: input.reason },
        correlationId: input.correlationId,
      });
      return { kickoffId: kickoff.id, version: updated.version };
    });
  });
}

export async function buildHandoffSourceSnapshot(
  tx: TransactionClient,
  onboardingId: string,
  outcomeNotes: string,
) {
  const onboarding = await tx.onboarding.findUniqueOrThrow({
    where: { id: onboardingId },
    include: {
      client: true,
      projectManager: true,
      clientRequirements: {
        where: { status: "APPROVED" },
        orderBy: { sequence: "asc" },
        include: {
          submissions: {
            where: { reviewDecision: "APPROVED" },
            orderBy: { submissionVersion: "desc" },
            take: 1,
            include: { files: { select: { originalFilename: true } } },
          },
        },
      },
    },
  });
  return buildHandoffSnapshot({
    onboardingId,
    clientName: onboarding.client?.companyName ?? "Unknown client",
    packageName: onboarding.servicePackageNameSnapshot ?? "Unknown package",
    projectManagerName: onboarding.projectManager?.name ?? "Unassigned",
    kickoffOutcomeNotes: outcomeNotes,
    approvedRequirements: onboarding.clientRequirements.map((requirement) => ({
      requirementId: requirement.id,
      title: requirement.name,
      responseText:
        requirement.submissions[0]?.textValue ?? requirement.submissions[0]?.urlValue ?? null,
      fileNames: requirement.submissions[0]?.files.map((file) => file.originalFilename) ?? [],
    })),
  });
}

export async function completeKickoff(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(completeKickoffSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        const { actor, onboarding } = await authorizedKickoff(
          tx,
          input.actorId,
          input.onboardingId,
        );
        const kickoff = onboarding.kickoff;
        const fingerprint = phase6Fingerprint({
          outcomeNotes: input.outcomeNotes,
          timingOverrideReason: input.timingOverrideReason,
        });
        const completionIdempotencyKey = kickoff
          ? `KICKOFF_COMPLETE:${kickoff.id}:${input.idempotencyKey}`
          : null;
        if (
          kickoff?.completionIdempotencyKey === completionIdempotencyKey &&
          kickoff.completionFingerprint === fingerprint &&
          kickoff.status === KickoffStatus.COMPLETED
        ) {
          const handoff = await tx.deliveryHandoff.findUniqueOrThrow({
            where: { onboardingId: onboarding.id },
          });
          return { kickoffId: kickoff.id, handoffId: handoff.id, idempotent: true };
        }
        if (
          !kickoff ||
          kickoff.status !== KickoffStatus.SCHEDULED ||
          kickoff.version !== input.expectedKickoffVersion ||
          !kickoff.scheduledStartAt
        ) {
          reject("VERSION_CONFLICT", "Kickoff is not in the expected scheduled state.");
        }
        if (!validOutcomeNotes(input.outcomeNotes))
          reject("INVALID_INPUT", "Outcome notes must contain 40–5000 characters.");
        const invitation = await tx.notificationLog.findFirst({
          where: {
            kickoffId: kickoff.id,
            notificationType: "KICKOFF_INVITATION",
            businessRevision: kickoff.scheduleRevision,
          },
          orderBy: { createdAt: "desc" },
        });
        const hasDeliveryProof = invitation?.status === NotificationStatus.SENT;
        const hasWaiver =
          kickoff.invitationWaivedAt &&
          kickoff.invitationWaivedById &&
          kickoff.invitationWaiverReason &&
          kickoff.invitationWaivedForRevision === kickoff.scheduleRevision;
        if (!hasDeliveryProof && !hasWaiver) {
          reject(
            "INVALID_TRANSITION",
            "Current kickoff invitation must be sent or explicitly waived.",
          );
        }
        const clock = await tx.$queryRaw<Array<{ now: Date }>>(
          Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
        );
        if (
          !canCompleteKickoff(
            kickoff.scheduledStartAt,
            clock[0]!.now,
            actor.role === Role.ADMIN,
            input.timingOverrideReason,
          )
        ) {
          reject("INVALID_TRANSITION", "Kickoff cannot be completed more than 15 minutes early.");
        }
        if (input.timingOverrideReason && actor.role !== Role.ADMIN) {
          reject("ACCESS_DENIED", "Only an Admin may override kickoff timing.");
        }
        const snapshot = await buildHandoffSourceSnapshot(tx, onboarding.id, input.outcomeNotes);
        await tx.kickoff.update({
          where: { id: kickoff.id },
          data: {
            status: KickoffStatus.COMPLETED,
            completedAt: clock[0]!.now,
            completedById: actor.id,
            outcomeNotes: input.outcomeNotes,
            completionIdempotencyKey,
            completionFingerprint: fingerprint,
            completionTimingOverrideReason: input.timingOverrideReason,
            version: { increment: 1 },
          },
        });
        const handoff = await tx.deliveryHandoff.create({
          data: {
            onboardingId: onboarding.id,
            status: "DRAFT",
            sourceSnapshot: snapshot.snapshot as Prisma.InputJsonObject,
            sourceFingerprint: snapshot.fingerprint,
            summarySchemaVersion: HANDOFF_SUMMARY_SCHEMA_VERSION,
          },
        });
        await tx.onboarding.update({
          where: { id: onboarding.id },
          data: {
            status: OnboardingStatus.PROJECT_READY,
            projectReadyAt: clock[0]!.now,
            version: { increment: 1 },
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: actor.id,
          action: "PROJECT_READY",
          entityType: "ONBOARDING",
          entityId: onboarding.id,
          previousValue: { status: onboarding.status },
          newValue: { status: OnboardingStatus.PROJECT_READY },
          metadata: {
            kickoffId: kickoff.id,
            handoffId: handoff.id,
            timingOverride: Boolean(input.timingOverrideReason),
          },
          correlationId: input.correlationId,
        });
        return { kickoffId: kickoff.id, handoffId: handoff.id, idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

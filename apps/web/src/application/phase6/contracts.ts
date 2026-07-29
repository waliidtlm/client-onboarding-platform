import { z } from "zod";

const uuid = z.uuid();
const correlationId = uuid;
const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);
const expectedVersion = z.coerce.number().int().nonnegative();
const reason = z.string().trim().min(10).max(1_000);
const machineIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const machinePhase6RunSchema = z
  .object({
    eventId: uuid,
    runId: uuid,
    idempotencyKey: machineIdentifier.max(255),
    workerId: machineIdentifier.max(100),
    n8nExecutionId: machineIdentifier.max(100),
  })
  .strict();

export const scheduleKickoffSchema = z
  .object({
    actorId: uuid,
    onboardingId: uuid,
    expectedKickoffVersion: expectedVersion,
    idempotencyKey,
    localDate: z.iso.date(),
    localTime: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
    timezone: z.string().trim().min(1).max(100),
    ambiguityChoice: z.enum(["EARLIER", "LATER"]).optional(),
    meetingUrl: z.url().max(2_000).nullable().default(null),
    meetingLocation: z.string().trim().min(1).max(500).nullable().default(null),
    reason: reason.nullable().default(null),
    correlationId,
  })
  .strict();

export const waiveKickoffInvitationSchema = z
  .object({
    actorId: uuid,
    onboardingId: uuid,
    expectedKickoffVersion: expectedVersion,
    reason,
    correlationId,
  })
  .strict();

export const completeKickoffSchema = z
  .object({
    actorId: uuid,
    onboardingId: uuid,
    expectedKickoffVersion: expectedVersion,
    idempotencyKey,
    outcomeNotes: z.string().trim().min(40).max(5_000),
    timingOverrideReason: reason.nullable().default(null),
    correlationId,
  })
  .strict();

export const saveHandoffDraftSchema = z
  .object({
    actorId: uuid,
    onboardingId: uuid,
    expectedHandoffVersion: expectedVersion,
    assignedDeliveryId: uuid.nullable().default(null),
    summary: z.string().trim().min(40).max(5_000).nullable().default(null),
    riskNotes: z.string().trim().max(5_000).nullable().default(null),
    nextActions: z.string().trim().max(5_000).nullable().default(null),
    correlationId,
  })
  .strict();

export const markHandoffReadySchema = z
  .object({
    actorId: uuid,
    onboardingId: uuid,
    expectedHandoffVersion: expectedVersion,
    idempotencyKey,
    correlationId,
  })
  .strict();

export const reassignHandoffSchema = z
  .object({
    actorId: uuid,
    onboardingId: uuid,
    expectedHandoffVersion: expectedVersion,
    assignedDeliveryId: uuid,
    reason,
    idempotencyKey,
    correlationId,
  })
  .strict();

export const acknowledgeHandoffSchema = z
  .object({
    actorId: uuid,
    onboardingId: uuid,
    expectedHandoffVersion: expectedVersion,
    expectedOnboardingVersion: expectedVersion,
    idempotencyKey,
    adminExceptionReason: reason.nullable().default(null),
    correlationId,
  })
  .strict();

export const cancelPhase6Schema = z
  .object({
    actorId: uuid,
    onboardingId: uuid,
    expectedOnboardingVersion: expectedVersion,
    reason,
    correlationId,
  })
  .strict();

export const resolvePhase6UncertaintySchema = z
  .object({
    actorId: uuid,
    notificationId: uuid,
    expectedOnboardingVersion: expectedVersion,
    decision: z.enum(["CONFIRM_SENT", "RETRY"]),
    providerReference: z.string().trim().min(1).max(500).nullable().default(null),
    reason,
    correlationId,
  })
  .strict();

import { z } from "zod";

const safeIdempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const manageClientAccessSchema = z
  .object({
    actorId: z.uuid(),
    onboardingId: z.uuid(),
    expectedVersion: z.int().positive(),
    issuanceKey: safeIdempotencyKey,
    operation: z.enum(["ISSUE", "REISSUE"]),
    correlationId: z.uuid(),
  })
  .strict();

export const revokeClientAccessSchema = z
  .object({
    actorId: z.uuid(),
    onboardingId: z.uuid(),
    expectedVersion: z.int().positive(),
    reason: z.string().trim().min(10).max(2_000),
    correlationId: z.uuid(),
  })
  .strict();

export const resolveClientAccessEmailSchema = z
  .object({
    actorId: z.uuid(),
    notificationId: z.uuid(),
    action: z.enum(["CONFIRM_SENT", "AUTHORIZE_RESEND"]),
    providerReference: z.string().trim().min(1).max(500).nullable(),
    reason: z.string().trim().min(10).max(2_000),
    correlationId: z.uuid(),
  })
  .strict();

export const exchangeClientTokenSchema = z
  .object({
    token: z.string().min(1).max(300),
  })
  .strict();

export type ManageClientAccessInput = z.infer<typeof manageClientAccessSchema>;

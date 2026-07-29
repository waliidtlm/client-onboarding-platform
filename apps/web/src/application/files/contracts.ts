import { z } from "zod";

const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const createUploadIntentSchema = z
  .object({
    tokenId: z.uuid(),
    onboardingId: z.uuid(),
    requirementId: z.uuid(),
    originalFilename: z.string().min(1).max(255),
    declaredMimeType: z.string().trim().min(1).max(200),
    declaredSizeBytes: z.int().positive(),
    declaredChecksum: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[0-9a-f]{64}$/),
    idempotencyKey,
  })
  .strict();

export const finalizeUploadIntentSchema = z
  .object({
    tokenId: z.uuid(),
    onboardingId: z.uuid(),
    uploadIntentId: z.uuid(),
  })
  .strict();

import { z } from "zod";

const idempotencyKey = z
  .string()
  .trim()
  .min(8)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const submitRequirementSchema = z
  .object({
    tokenId: z.uuid(),
    onboardingId: z.uuid(),
    requirementId: z.uuid(),
    textValue: z.string().nullable().optional(),
    urlValue: z.string().nullable().optional(),
    fileAssetIds: z.array(z.uuid()).max(5).default([]),
    submissionIdempotencyKey: idempotencyKey,
    correlationId: z.uuid(),
  })
  .strict();

const reviewBase = z
  .object({
    actorId: z.uuid(),
    onboardingId: z.uuid(),
    requirementId: z.uuid(),
    expectedRequirementVersion: z.int().positive(),
    expectedSubmissionVersion: z.int().positive(),
    correlationId: z.uuid(),
  })
  .strict();

export const beginRequirementReviewSchema = reviewBase;
export const approveRequirementSchema = reviewBase;
export const rejectRequirementSchema = reviewBase
  .extend({
    reason: z.string().trim().min(10).max(2_000),
  })
  .strict();

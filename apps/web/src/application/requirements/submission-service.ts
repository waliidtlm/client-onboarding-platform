import {
  AuditActorType,
  OnboardingStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { appendAuditEvent } from "@/application/commercial/audit";
import { executeService, parseInput, reject } from "@/application/commercial/service-support";
import { submitRequirementSchema } from "@/application/requirements/contracts";
import { requestFingerprint } from "@/domain/requirements/idempotency";
import { validateRequirementSubmission } from "@/domain/requirements/submission-validation";
import type { Result } from "@/domain/errors";
import { prisma } from "@/lib/database";

export async function submitClientRequirement(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<
  Result<
    Readonly<{
      requirementId: string;
      submissionId: string;
      submissionVersion: number;
      requirementVersion: number;
      idempotent: boolean;
    }>
  >
> {
  return executeService(async () => {
    const input = parseInput(submitRequirementSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${input.onboardingId}::uuid
          FOR UPDATE
        `);
        const [onboarding, token] = await Promise.all([
          tx.onboarding.findUnique({ where: { id: input.onboardingId } }),
          tx.clientAccessToken.findUnique({ where: { id: input.tokenId } }),
        ]);
        const now = new Date();
        if (
          !onboarding ||
          onboarding.status !== OnboardingStatus.CLIENT_AWAITING_ACTION ||
          onboarding.cancelledAt ||
          !token ||
          token.onboardingId !== onboarding.id ||
          token.revokedAt ||
          token.expiresAt <= now
        ) {
          reject("CLIENT_ACCESS_INVALID", "Secure access is unavailable.");
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "ClientRequirement"
          WHERE "id" = ${input.requirementId}::uuid
          FOR UPDATE
        `);
        const requirement = await tx.clientRequirement.findUnique({
          where: { id: input.requirementId },
        });
        if (!requirement || requirement.onboardingId !== onboarding.id) {
          reject("CLIENT_ACCESS_INVALID", "Secure access is unavailable.");
        }
        const assets = await tx.fileAsset.findMany({
          where: { id: { in: input.fileAssetIds } },
          include: {
            uploadIntent: {
              include: { clientAccessToken: true },
            },
          },
        });
        if (
          assets.length !== input.fileAssetIds.length ||
          assets.some(
            (asset) =>
              asset.onboardingId !== onboarding.id ||
              asset.requirementId !== requirement.id ||
              asset.requirementSubmissionId ||
              asset.uploadIntent.status !== "FINALIZED" ||
              asset.uploadIntent.clientAccessToken.revokedAt ||
              asset.uploadIntent.clientAccessToken.expiresAt <= now,
          )
        ) {
          reject("FILE_VALIDATION_FAILED", "A submitted file is not eligible.");
        }
        const orderedAssets = input.fileAssetIds.map((id) =>
          assets.find((asset) => asset.id === id)!,
        );
        const validated = validateRequirementSubmission(requirement.inputType, {
          ...(input.textValue !== undefined ? { textValue: input.textValue } : {}),
          ...(input.urlValue !== undefined ? { urlValue: input.urlValue } : {}),
          files: orderedAssets.map((asset) => ({ id: asset.id, sizeBytes: asset.sizeBytes })),
        });
        if (!validated.ok) {
          reject("INVALID_INPUT", "The submission does not match the requirement input type.", {
            submission: [validated.code],
          });
        }
        const fingerprint = requestFingerprint({
          textValue: validated.textValue,
          urlValue: validated.urlValue,
          fileAssetIds: validated.orderedFileIds,
        });
        const replay = await tx.requirementSubmission.findUnique({
          where: {
            requirementId_submissionIdempotencyKey: {
              requirementId: requirement.id,
              submissionIdempotencyKey: input.submissionIdempotencyKey,
            },
          },
        });
        if (replay) {
          if (replay.requestFingerprint !== fingerprint) {
            reject(
              "REQUIREMENT_SUBMISSION_CONFLICT",
              "The submission key was used for different content.",
            );
          }
          return {
            requirementId: requirement.id,
            submissionId: replay.id,
            submissionVersion: replay.submissionVersion,
            requirementVersion: requirement.version,
            idempotent: true,
          };
        }
        if (!["PENDING", "REJECTED"].includes(requirement.status)) {
          reject("INVALID_TRANSITION", "This requirement cannot be submitted now.");
        }
        const submissionVersion = requirement.currentSubmissionVersion + 1;
        const submission = await tx.requirementSubmission.create({
          data: {
            requirementId: requirement.id,
            submissionVersion,
            textValue: validated.textValue,
            urlValue: validated.urlValue,
            submittedViaTokenId: token.id,
            submissionIdempotencyKey: input.submissionIdempotencyKey,
            requestFingerprint: fingerprint,
            submittedAt: now,
          },
        });
        for (const [index, assetId] of validated.orderedFileIds.entries()) {
          await tx.fileAsset.update({
            where: { id: assetId },
            data: {
              requirementSubmissionId: submission.id,
              displayOrder: index + 1,
            },
          });
        }
        await tx.clientRequirement.update({
          where: { id: requirement.id },
          data: {
            status: "SUBMITTED",
            currentSubmissionVersion: submissionVersion,
            reviewingSubmissionVersion: null,
            approvedById: null,
            approvedAt: null,
            version: { increment: 1 },
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.CLIENT,
          clientAccessTokenId: token.id,
          action:
            submissionVersion === 1
              ? "CLIENT_REQUIREMENT_SUBMITTED"
              : "CLIENT_REQUIREMENT_RESUBMITTED",
          entityType: "REQUIREMENT_SUBMISSION",
          entityId: submission.id,
          previousValue: {
            requirementStatus: requirement.status,
            submissionVersion: requirement.currentSubmissionVersion,
          },
          newValue: {
            requirementStatus: "SUBMITTED",
            submissionVersion,
            fileCount: validated.orderedFileIds.length,
          },
          metadata: { requirementId: requirement.id },
          correlationId: input.correlationId,
        });
        return {
          requirementId: requirement.id,
          submissionId: submission.id,
          submissionVersion,
          requirementVersion: requirement.version + 1,
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

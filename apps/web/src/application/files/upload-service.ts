import { createHash, randomBytes } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";

import {
  FileUploadIntentStatus,
  OnboardingStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { executeService, parseInput, reject } from "@/application/commercial/service-support";
import {
  createUploadIntentSchema,
  finalizeUploadIntentSchema,
} from "@/application/files/contracts";
import {
  ALLOWED_FILE_TYPES,
  isAllowedDetectedFile,
  MAX_FILE_BYTES,
  normalizeDisplayFilename,
  UPLOAD_INTENT_SECONDS,
} from "@/domain/requirements/file-policy";
import { requestFingerprint } from "@/domain/requirements/idempotency";
import { isValidOfficeOpenXml } from "@/domain/requirements/ooxml-validation";
import type { Result } from "@/domain/errors";
import {
  copyStoredObject,
  deleteStoredObject,
  headStoredObject,
  presignUpload,
  readStoredObject,
} from "@/infrastructure/storage/s3-object-storage";
import { prisma } from "@/lib/database";

function randomStorageComponent(): string {
  return randomBytes(32).toString("base64url");
}

const allowedDeclaredMimes = new Set<string>(Object.values(ALLOWED_FILE_TYPES));

export async function createFileUploadIntent(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<
  Result<
    Readonly<{
      uploadIntentId: string;
      uploadUrl: string;
      requiredHeaders: Readonly<Record<string, string>>;
      expiresAt: string;
      idempotent: boolean;
    }>
  >
> {
  return executeService(async () => {
    const input = parseInput(createUploadIntentSchema.safeParse(rawInput));
    const originalFilename = normalizeDisplayFilename(input.originalFilename);
    if (
      !originalFilename ||
      input.declaredSizeBytes > MAX_FILE_BYTES ||
      !allowedDeclaredMimes.has(input.declaredMimeType)
    ) {
      reject("FILE_VALIDATION_FAILED", "The file declaration is not allowed.");
    }
    const fingerprint = requestFingerprint({
      onboardingId: input.onboardingId,
      requirementId: input.requirementId,
      originalFilename,
      declaredMimeType: input.declaredMimeType,
      declaredSizeBytes: input.declaredSizeBytes,
      declaredChecksum: input.declaredChecksum,
    });
    const intent = await database.$transaction(
      async (tx) => {
        const replay = await tx.fileUploadIntent.findUnique({
          where: {
            clientAccessTokenId_idempotencyKey: {
              clientAccessTokenId: input.tokenId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        if (replay) {
          if (replay.requestFingerprint !== fingerprint) {
            reject("FILE_UPLOAD_CONFLICT", "The upload key was used for different file metadata.");
          }
          if (
            replay.status === FileUploadIntentStatus.EXPIRED ||
            replay.status === FileUploadIntentStatus.REJECTED ||
            replay.expiresAt <= new Date()
          ) {
            reject("FILE_UPLOAD_EXPIRED", "The upload intent is no longer available.");
          }
          return { intent: replay, idempotent: true };
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${input.onboardingId}::uuid
          FOR UPDATE
        `);
        const [onboarding, token] = await Promise.all([
          tx.onboarding.findUnique({ where: { id: input.onboardingId } }),
          tx.clientAccessToken.findUnique({ where: { id: input.tokenId } }),
        ]);
        if (
          !onboarding ||
          onboarding.status !== OnboardingStatus.CLIENT_AWAITING_ACTION ||
          onboarding.cancelledAt ||
          !token ||
          token.onboardingId !== onboarding.id ||
          token.revokedAt ||
          token.expiresAt <= new Date()
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
        if (
          !requirement ||
          requirement.onboardingId !== onboarding.id ||
          !["FILE", "MULTI_FILE"].includes(requirement.inputType) ||
          !["PENDING", "REJECTED"].includes(requirement.status)
        ) {
          reject("INVALID_TRANSITION", "This requirement cannot accept a file upload.");
        }
        const now = new Date();
        return {
          intent: await tx.fileUploadIntent.create({
            data: {
              clientAccessTokenId: token.id,
              onboardingId: onboarding.id,
              requirementId: requirement.id,
              expectedInputType: requirement.inputType,
              uploadStorageKey: `temporary/${onboarding.id}/${randomStorageComponent()}`,
              finalStorageKey: `final/${onboarding.id}/${randomStorageComponent()}`,
              originalFilename,
              declaredMimeType: input.declaredMimeType,
              declaredSizeBytes: BigInt(input.declaredSizeBytes),
              declaredChecksum: input.declaredChecksum,
              idempotencyKey: input.idempotencyKey,
              requestFingerprint: fingerprint,
              expiresAt: new Date(now.getTime() + UPLOAD_INTENT_SECONDS * 1_000),
            },
          }),
          idempotent: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const signed = await presignUpload({
      storageKey: intent.intent.uploadStorageKey,
      contentType: intent.intent.declaredMimeType,
      checksum: intent.intent.declaredChecksum,
    });
    return {
      uploadIntentId: intent.intent.id,
      uploadUrl: signed.url,
      requiredHeaders: signed.requiredHeaders,
      expiresAt: intent.intent.expiresAt.toISOString(),
      idempotent: intent.idempotent,
    };
  });
}

async function rejectIntent(
  database: PrismaClient,
  intentId: string,
  failureCode: string,
): Promise<void> {
  await database.fileUploadIntent.updateMany({
    where: {
      id: intentId,
      status: { in: [FileUploadIntentStatus.PENDING, FileUploadIntentStatus.FINALIZING] },
    },
    data: {
      status: FileUploadIntentStatus.REJECTED,
      failureCode,
      version: { increment: 1 },
    },
  });
}

export async function finalizeFileUploadIntent(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(finalizeUploadIntentSchema.safeParse(rawInput));
    const reservation = await database.$transaction(
      async (tx) => {
        const initial = await tx.fileUploadIntent.findUnique({
          where: { id: input.uploadIntentId },
          include: { fileAsset: true },
        });
        if (
          !initial ||
          initial.clientAccessTokenId !== input.tokenId ||
          initial.onboardingId !== input.onboardingId
        ) {
          reject("CLIENT_ACCESS_INVALID", "Secure access is unavailable.");
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${input.onboardingId}::uuid
          FOR UPDATE
        `);
        const onboarding = await tx.onboarding.findUniqueOrThrow({
          where: { id: input.onboardingId },
        });
        if (
          onboarding.status !== OnboardingStatus.CLIENT_AWAITING_ACTION ||
          onboarding.cancelledAt
        ) {
          reject("INVALID_TRANSITION", "The onboarding no longer accepts uploads.");
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "FileUploadIntent"
          WHERE "id" = ${input.uploadIntentId}::uuid
          FOR UPDATE
        `);
        const intent = await tx.fileUploadIntent.findUniqueOrThrow({
          where: { id: input.uploadIntentId },
          include: { fileAsset: true, clientAccessToken: true, requirement: true },
        });
        if (
          intent.clientAccessToken.revokedAt ||
          intent.clientAccessToken.expiresAt <= new Date() ||
          intent.requirement.onboardingId !== onboarding.id ||
          !["PENDING", "REJECTED"].includes(intent.requirement.status)
        ) {
          reject("CLIENT_ACCESS_INVALID", "Secure access is unavailable.");
        }
        if (intent.fileAsset) {
          if (intent.status !== FileUploadIntentStatus.FINALIZED) {
            await tx.fileUploadIntent.update({
              where: { id: intent.id },
              data: {
                status: FileUploadIntentStatus.FINALIZED,
                finalizedAt: intent.fileAsset.finalizedAt,
                failureCode: null,
                version: { increment: 1 },
              },
            });
          }
          return { intent, fileAsset: intent.fileAsset, replay: true };
        }
        if (
          intent.status === FileUploadIntentStatus.EXPIRED ||
          intent.status === FileUploadIntentStatus.REJECTED ||
          intent.expiresAt <= new Date()
        ) {
          let wasExpiredNow = false;
          if (
            intent.expiresAt <= new Date() &&
            intent.status !== FileUploadIntentStatus.EXPIRED &&
            intent.status !== FileUploadIntentStatus.REJECTED
          ) {
            await tx.fileUploadIntent.update({
              where: { id: intent.id },
              data: {
                status: FileUploadIntentStatus.EXPIRED,
                failureCode: "INTENT_EXPIRED",
                version: { increment: 1 },
              },
            });
            wasExpiredNow = true;
          }
          return {
            intent,
            fileAsset: null,
            replay: false,
            expired: true as const,
            wasExpiredNow,
          };
        }
        if (intent.status === FileUploadIntentStatus.PENDING) {
          await tx.fileUploadIntent.update({
            where: { id: intent.id },
            data: { status: FileUploadIntentStatus.FINALIZING, version: { increment: 1 } },
          });
        }
        return { intent, fileAsset: null, replay: false, expired: false as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (reservation.expired) {
      reject("FILE_UPLOAD_EXPIRED", "The upload intent expired.");
    }
    const reserved = reservation;
    if (reserved.fileAsset) {
      return {
        fileAssetId: reserved.fileAsset.id,
        mimeType: reserved.fileAsset.mimeType,
        sizeBytes: reserved.fileAsset.sizeBytes.toString(),
        idempotent: true,
      };
    }
    let temporaryHead;
    try {
      temporaryHead = await headStoredObject(reserved.intent.uploadStorageKey);
    } catch {
      await rejectIntent(database, reserved.intent.id, "OBJECT_MISSING");
      reject("FILE_VALIDATION_FAILED", "The uploaded object is missing.");
    }
    if (
      temporaryHead.ContentLength === undefined ||
      temporaryHead.ContentLength > MAX_FILE_BYTES ||
      BigInt(temporaryHead.ContentLength) !== reserved.intent.declaredSizeBytes
    ) {
      await rejectIntent(database, reserved.intent.id, "CONTENT_LENGTH_INVALID");
      reject("FILE_VALIDATION_FAILED", "The uploaded file failed content verification.");
    }
    let temporaryBytes: Buffer;
    try {
      temporaryBytes = await readStoredObject(reserved.intent.uploadStorageKey);
    } catch {
      await rejectIntent(database, reserved.intent.id, "OBJECT_READ_FAILED");
      reject("FILE_VALIDATION_FAILED", "The uploaded object could not be read.");
    }
    const actualSize = BigInt(temporaryBytes.byteLength);
    const actualChecksum = createHash("sha256").update(temporaryBytes).digest("hex");
    const detected = await fileTypeFromBuffer(temporaryBytes);
    const officeContainerIsValid =
      detected?.ext === "docx"
        ? isValidOfficeOpenXml(temporaryBytes, "docx")
        : detected?.ext === "xlsx"
          ? isValidOfficeOpenXml(temporaryBytes, "xlsx")
          : true;
    if (
      temporaryHead.ContentLength === undefined ||
      BigInt(temporaryHead.ContentLength) !== reserved.intent.declaredSizeBytes ||
      actualSize !== reserved.intent.declaredSizeBytes ||
      temporaryHead.ContentType !== reserved.intent.declaredMimeType ||
      temporaryHead.Metadata?.sha256 !== reserved.intent.declaredChecksum ||
      actualChecksum !== reserved.intent.declaredChecksum ||
      !isAllowedDetectedFile(detected?.ext, detected?.mime) ||
      detected?.mime !== reserved.intent.declaredMimeType ||
      !officeContainerIsValid
    ) {
      await rejectIntent(database, reserved.intent.id, "CONTENT_VERIFICATION_FAILED");
      reject("FILE_VALIDATION_FAILED", "The uploaded file failed content verification.");
    }
    let finalMatches = false;
    try {
      const finalBytes = await readStoredObject(reserved.intent.finalStorageKey);
      finalMatches =
        finalBytes.byteLength === temporaryBytes.byteLength &&
        createHash("sha256").update(finalBytes).digest("hex") === actualChecksum;
    } catch {
      finalMatches = false;
    }
    if (!finalMatches) {
      await copyStoredObject(reserved.intent.uploadStorageKey, reserved.intent.finalStorageKey);
      const copied = await readStoredObject(reserved.intent.finalStorageKey);
      if (createHash("sha256").update(copied).digest("hex") !== actualChecksum) {
        await rejectIntent(database, reserved.intent.id, "FINAL_COPY_MISMATCH");
        reject("FILE_VALIDATION_FAILED", "The finalized object could not be verified.");
      }
    }
    const fileAsset = await database.$transaction(
      async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Onboarding"
          WHERE "id" = ${input.onboardingId}::uuid
          FOR UPDATE
        `);
        const onboarding = await tx.onboarding.findUniqueOrThrow({
          where: { id: input.onboardingId },
        });
        if (
          onboarding.status !== OnboardingStatus.CLIENT_AWAITING_ACTION ||
          onboarding.cancelledAt
        ) {
          reject("INVALID_TRANSITION", "The onboarding no longer accepts uploads.");
        }
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "FileUploadIntent"
          WHERE "id" = ${input.uploadIntentId}::uuid
          FOR UPDATE
        `);
        const current = await tx.fileUploadIntent.findUniqueOrThrow({
          where: { id: input.uploadIntentId },
          include: { fileAsset: true, clientAccessToken: true },
        });
        if (current.fileAsset) {
          if (current.status !== FileUploadIntentStatus.FINALIZED) {
            await tx.fileUploadIntent.update({
              where: { id: current.id },
              data: {
                status: FileUploadIntentStatus.FINALIZED,
                finalizedAt: current.fileAsset.finalizedAt,
                failureCode: null,
                version: { increment: 1 },
              },
            });
          }
          return current.fileAsset;
        }
        if (
          current.status !== FileUploadIntentStatus.FINALIZING ||
          current.clientAccessToken.revokedAt ||
          current.clientAccessToken.expiresAt <= new Date()
        ) {
          reject("FILE_UPLOAD_CONFLICT", "The upload finalization changed.");
        }
        const now = new Date();
        const created = await tx.fileAsset.create({
          data: {
            onboardingId: current.onboardingId,
            requirementId: current.requirementId,
            uploadIntentId: current.id,
            storageKey: current.finalStorageKey,
            originalFilename: current.originalFilename,
            mimeType: detected!.mime,
            sizeBytes: actualSize,
            checksum: actualChecksum,
            uploadedAt: temporaryHead.LastModified ?? now,
            finalizedAt: now,
          },
        });
        await tx.fileUploadIntent.update({
          where: { id: current.id },
          data: {
            status: FileUploadIntentStatus.FINALIZED,
            finalizedAt: now,
            failureCode: null,
            version: { increment: 1 },
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await deleteStoredObject(reserved.intent.uploadStorageKey).catch(() => undefined);
    return {
      fileAssetId: fileAsset.id,
      mimeType: fileAsset.mimeType,
      sizeBytes: fileAsset.sizeBytes.toString(),
      idempotent: reserved.replay,
    };
  });
}

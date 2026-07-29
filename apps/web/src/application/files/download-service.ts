import { Role, type PrismaClient } from "@/generated/prisma/client";
import { executeService, reject, requireActor } from "@/application/commercial/service-support";
import { DOWNLOAD_URL_SECONDS, safeContentDisposition } from "@/domain/requirements/file-policy";
import { presignDownload } from "@/infrastructure/storage/s3-object-storage";
import { prisma } from "@/lib/database";

async function signedAssetUrl(asset: { storageKey: string; originalFilename: string }) {
  return {
    url: await presignDownload(asset.storageKey, safeContentDisposition(asset.originalFilename)),
    expiresInSeconds: DOWNLOAD_URL_SECONDS,
  };
}

export async function createClientFileDownload(
  assetId: string,
  access: { onboardingId: string; tokenId: string },
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const asset = await database.fileAsset.findFirst({
      where: {
        id: assetId,
        onboardingId: access.onboardingId,
        requirementSubmissionId: { not: null },
        onboarding: {
          cancelledAt: null,
          clientAccessTokens: {
            some: {
              id: access.tokenId,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
          },
        },
      },
      select: { storageKey: true, originalFilename: true },
    });
    if (!asset) reject("NOT_FOUND", "The file is unavailable.");
    return signedAssetUrl(asset);
  });
}

export async function createStaffFileDownload(
  assetId: string,
  actorId: string,
  database: PrismaClient = prisma,
) {
  return executeService(async () => {
    const actor = await requireActor(database, actorId, [Role.ADMIN, Role.PROJECT_MANAGER]);
    const asset = await database.fileAsset.findFirst({
      where: { id: assetId, requirementSubmissionId: { not: null } },
      select: {
        storageKey: true,
        originalFilename: true,
        onboarding: {
          select: {
            projectManagerId: true,
            projectManager: { select: { isActive: true } },
          },
        },
      },
    });
    if (!asset) reject("NOT_FOUND", "The file is unavailable.");
    if (
      actor.role === Role.PROJECT_MANAGER &&
      (asset.onboarding.projectManagerId !== actor.id || !asset.onboarding.projectManager?.isActive)
    ) {
      reject("ACCESS_DENIED", "Only the assigned active Project Manager may read this file.");
    }
    return signedAssetUrl(asset);
  });
}

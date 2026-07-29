import { FileUploadIntentStatus, Prisma, type PrismaClient } from "@/generated/prisma/client";
import { deleteStoredObject } from "@/infrastructure/storage/s3-object-storage";
import { prisma } from "@/lib/database";

export async function recoverAndCleanupUploadIntents(
  database: PrismaClient = prisma,
  limit = 50,
): Promise<
  Readonly<{
    expired: number;
    finalizedRecovered: number;
    temporaryObjectsDeleted: number;
    orphanFinalObjectsDeleted: number;
  }>
> {
  const intents = await database.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "FileUploadIntent"
      WHERE (
        ("status" IN ('PENDING', 'FINALIZING') AND "expiresAt" <= CURRENT_TIMESTAMP)
        OR
        ("status" = 'EXPIRED' AND "failureCode" = 'INTENT_EXPIRED')
      )
      ORDER BY "updatedAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${Math.max(1, Math.min(limit, 100))}
    `);
    const values = await tx.fileUploadIntent.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
      include: { fileAsset: true },
    });
    const expiredIds = values
      .filter(
        (intent) =>
          !intent.fileAsset &&
          intent.expiresAt <= new Date() &&
          (intent.status === FileUploadIntentStatus.PENDING ||
            intent.status === FileUploadIntentStatus.FINALIZING),
      )
      .map((intent) => intent.id);
    const repairable = values.filter(
      (intent) => intent.fileAsset && intent.status !== FileUploadIntentStatus.FINALIZED,
    );
    for (const intent of repairable) {
      await tx.fileUploadIntent.update({
        where: { id: intent.id },
        data: {
          status: FileUploadIntentStatus.FINALIZED,
          finalizedAt: intent.fileAsset!.finalizedAt,
          failureCode: null,
          version: { increment: 1 },
        },
      });
    }
    if (expiredIds.length > 0) {
      await tx.fileUploadIntent.updateMany({
        where: { id: { in: expiredIds } },
        data: {
          status: FileUploadIntentStatus.EXPIRED,
          failureCode: "INTENT_EXPIRED",
          version: { increment: 1 },
        },
      });
    }
    return { values, expiredIds, repaired: repairable.length };
  });
  let temporaryObjectsDeleted = 0;
  let orphanFinalObjectsDeleted = 0;
  for (const intent of intents.values) {
    try {
      await deleteStoredObject(intent.uploadStorageKey);
      temporaryObjectsDeleted += 1;
      if (intent.fileAsset) continue;
      await deleteStoredObject(intent.finalStorageKey);
      orphanFinalObjectsDeleted += 1;
      await database.fileUploadIntent.updateMany({
        where: {
          id: intent.id,
          status: FileUploadIntentStatus.EXPIRED,
          failureCode: "INTENT_EXPIRED",
          fileAsset: null,
        },
        data: { failureCode: "INTENT_EXPIRED_CLEANED" },
      });
    } catch {
      // Deletes are idempotent. A bounded later run retries only unattached expired intents.
    }
  }
  return {
    expired: intents.expiredIds.length,
    finalizedRecovered: intents.repaired,
    temporaryObjectsDeleted,
    orphanFinalObjectsDeleted,
  };
}

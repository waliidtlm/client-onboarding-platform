import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileUploadIntentStatus, type PrismaClient } from "@/generated/prisma/client";
import { recoverAndCleanupUploadIntents } from "@/application/files/cleanup-service";
import { deleteStoredObject } from "@/infrastructure/storage/s3-object-storage";

vi.mock("@/infrastructure/storage/s3-object-storage", () => ({
  deleteStoredObject: vi.fn().mockResolvedValue(undefined),
}));

const mockedDelete = vi.mocked(deleteStoredObject);

function fakeDatabase(intent: {
  id: string;
  status: FileUploadIntentStatus;
  expiresAt: Date;
  uploadStorageKey: string;
  finalStorageKey: string;
  fileAsset: { finalizedAt: Date } | null;
}) {
  const update = vi.fn().mockResolvedValue(undefined);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const transaction = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: intent.id }]),
    fileUploadIntent: {
      findMany: vi.fn().mockResolvedValue([intent]),
      update,
      updateMany,
    },
  };
  const database = {
    $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) => work(transaction)),
    fileUploadIntent: { updateMany },
  } as unknown as PrismaClient;
  return { database, update };
}

describe("upload cleanup recovery", () => {
  beforeEach(() => {
    mockedDelete.mockClear();
  });

  it("repairs a crash after FileAsset insertion and never deletes the final object", async () => {
    const { database, update } = fakeDatabase({
      id: "intent-with-asset",
      status: FileUploadIntentStatus.FINALIZING,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      uploadStorageKey: "temporary/onboarding/upload",
      finalStorageKey: "final/onboarding/submitted",
      fileAsset: { finalizedAt: new Date("2026-07-29T10:00:00.000Z") },
    });

    const result = await recoverAndCleanupUploadIntents(database);

    expect(result.finalizedRecovered).toBe(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: FileUploadIntentStatus.FINALIZED }),
      }),
    );
    expect(mockedDelete).toHaveBeenCalledWith("temporary/onboarding/upload");
    expect(mockedDelete).not.toHaveBeenCalledWith("final/onboarding/submitted");
  });

  it("deletes both keys only for an expired unattached intent", async () => {
    const { database } = fakeDatabase({
      id: "orphan-intent",
      status: FileUploadIntentStatus.FINALIZING,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      uploadStorageKey: "temporary/onboarding/orphan",
      finalStorageKey: "final/onboarding/orphan",
      fileAsset: null,
    });

    const result = await recoverAndCleanupUploadIntents(database);

    expect(result.expired).toBe(1);
    expect(mockedDelete).toHaveBeenCalledWith("temporary/onboarding/orphan");
    expect(mockedDelete).toHaveBeenCalledWith("final/onboarding/orphan");
  });
});

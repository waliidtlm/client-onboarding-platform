import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkDatabaseConnection } from "@/lib/database";
import { checkObjectStorageConnection } from "@/infrastructure/storage/s3-object-storage";

vi.mock("@/lib/database", () => ({
  checkDatabaseConnection: vi.fn(),
}));
vi.mock("@/infrastructure/storage/s3-object-storage", () => ({
  checkObjectStorageConnection: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { GET } from "@/app/api/ready/route";

const mockedDatabaseCheck = vi.mocked(checkDatabaseConnection);
const mockedStorageCheck = vi.mocked(checkObjectStorageConnection);

describe("GET /api/ready", () => {
  beforeEach(() => {
    mockedDatabaseCheck.mockReset();
    mockedStorageCheck.mockReset();
    mockedStorageCheck.mockResolvedValue();
  });

  it("reports ready when PostgreSQL responds", async () => {
    mockedDatabaseCheck.mockResolvedValue();

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      checks: {
        database: "up",
        objectStorage: "up",
      },
    });
  });

  it("returns a safe unavailable response when PostgreSQL fails", async () => {
    mockedDatabaseCheck.mockRejectedValue(new Error("contains-sensitive-connection-details"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      checks: {
        database: "down",
        objectStorage: "up",
      },
    });
  });

  it("identifies an object-storage outage without exposing its error", async () => {
    mockedDatabaseCheck.mockResolvedValue();
    mockedStorageCheck.mockRejectedValue(new Error("contains-sensitive-storage-endpoint"));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "not_ready",
      checks: {
        database: "up",
        objectStorage: "down",
      },
    });
  });
});

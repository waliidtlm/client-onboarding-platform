import { afterAll, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

import { authorizeStaff } from "../../src/auth/options";
import { Role } from "../../src/generated/prisma/client";
import { createPrismaClient } from "../../src/lib/database";
import {
  consumeRateLimit,
  rateLimitSubjectHash,
  resetRateLimit,
} from "../../src/application/client-access/rate-limit-service";

vi.mock("next-auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth")>();
  return {
    ...original,
    getServerSession: vi.fn(),
  };
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testStaffPassword = process.env.TEST_STAFF_PASSWORD;

if (!testDatabaseUrl || !testStaffPassword) {
  throw new Error("TEST_DATABASE_URL and TEST_STAFF_PASSWORD are required");
}

const client = createPrismaClient(testDatabaseUrl);

afterAll(async () => {
  await client.$disconnect();
});

describe("database-backed credentials authentication", () => {
  it("accepts an active fictional user and normalizes email case", async () => {
    await expect(
      authorizeStaff({
        email: "ADMIN@NORTHSTAR.TEST",
        password: testStaffPassword,
      }),
    ).resolves.toMatchObject({
      email: "admin@northstar.test",
      role: Role.ADMIN,
    });
  });

  it.each([
    ["admin@northstar.test", "wrong-password"],
    ["unknown@northstar.test", "wrong-password"],
    ["disabled@northstar.test", testStaffPassword],
  ])("rejects unavailable credentials without revealing the reason", async (email, password) => {
    await expect(authorizeStaff({ email, password })).resolves.toBeNull();
  });

  it("revalidates active status and database role on a protected request", async () => {
    const user = await client.user.findUniqueOrThrow({
      where: { email: "delivery@northstar.test" },
    });

    vi.mocked(getServerSession).mockResolvedValue({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: Role.ADMIN,
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });

    const { getCurrentStaff } = await import("../../src/lib/auth/authorization");
    await expect(getCurrentStaff()).resolves.toMatchObject({ role: Role.DELIVERY });

    await client.user.update({
      where: { id: user.id },
      data: { isActive: false },
    });

    await expect(getCurrentStaff()).resolves.toBeNull();

    await client.user.update({
      where: { id: user.id },
      data: { isActive: true },
    });
  });

  it("stores only hashed login subjects and safely resets the account window", async () => {
    const account = `unknown-${crypto.randomUUID()}@northstar.test`;
    const expectedHash = rateLimitSubjectHash("STAFF_LOGIN_ACCOUNT", account);
    let result = { allowed: true, retryAfterSeconds: 0 };
    for (let attempt = 0; attempt < 11; attempt += 1) {
      result = await consumeRateLimit("STAFF_LOGIN_ACCOUNT", account, client);
    }
    expect(result.allowed).toBe(false);
    const buckets = await client.publicRateLimitBucket.findMany({
      where: { scope: "STAFF_LOGIN_ACCOUNT", subjectHash: expectedHash },
    });
    expect(buckets.length).toBeGreaterThan(0);
    expect(JSON.stringify(buckets)).not.toContain(account);

    await resetRateLimit("STAFF_LOGIN_ACCOUNT", account, client);
    await expect(
      client.publicRateLimitBucket.count({
        where: { scope: "STAFF_LOGIN_ACCOUNT", subjectHash: expectedHash },
      }),
    ).resolves.toBe(0);
  });
});

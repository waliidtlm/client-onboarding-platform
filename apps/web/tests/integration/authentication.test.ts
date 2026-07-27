import { afterAll, describe, expect, it, vi } from "vitest";
import { getServerSession } from "next-auth";

import { authorizeStaff } from "../../src/auth/options";
import { Role } from "../../src/generated/prisma/client";
import { createPrismaClient } from "../../src/lib/database";

vi.mock("next-auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth")>();
  return {
    ...original,
    getServerSession: vi.fn(),
  };
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required");
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
        password: process.env.DEMO_STAFF_PASSWORD ?? "Local-demo-only-password-2026",
      }),
    ).resolves.toMatchObject({
      email: "admin@northstar.test",
      role: Role.ADMIN,
    });
  });

  it.each([
    ["admin@northstar.test", "wrong-password"],
    ["unknown@northstar.test", "wrong-password"],
    ["disabled@northstar.test", "Local-demo-only-password-2026"],
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
});

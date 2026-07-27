import { spawnSync } from "node:child_process";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client";
import { seedDatabase } from "../../prisma/seed";

function requireDatabase(value: string | undefined, expected: string, label: string): string {
  if (!value || new URL(value).pathname !== `/${expected}`) {
    throw new Error(`${label} must target ${expected}`);
  }
  return value;
}

export async function prepareIntegrationDatabase(): Promise<void> {
  const testRuntimeUrl = requireDatabase(
    process.env.TEST_DATABASE_URL,
    "onboarding_test",
    "TEST_DATABASE_URL",
  );
  const testMigrationUrl = requireDatabase(
    process.env.TEST_MIGRATION_DATABASE_URL,
    "onboarding_test",
    "TEST_MIGRATION_DATABASE_URL",
  );
  requireDatabase(process.env.SHADOW_DATABASE_URL, "onboarding_shadow", "SHADOW_DATABASE_URL");

  if (testRuntimeUrl === testMigrationUrl) {
    throw new Error("Test runtime and migration credentials must be different");
  }
  const testStaffPassword = process.env.TEST_STAFF_PASSWORD;
  if (!testStaffPassword) {
    throw new Error("TEST_STAFF_PASSWORD is required for isolated integration data");
  }

  const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
  const executable = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const args =
    process.platform === "win32" ? ["/d", "/s", "/c", "pnpm.cmd db:reset:test"] : ["db:reset:test"];
  const reset = spawnSync(executable, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: "utf8",
  });

  if (reset.status !== 0) {
    throw new Error(
      `Test database reset failed: ${reset.error?.message ?? reset.stderr ?? reset.stdout ?? "unknown error"}`,
    );
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testMigrationUrl }),
  });

  try {
    await seedDatabase(client, testStaffPassword);
    await client.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO "onboarding_test_user"');
    await client.$executeRawUnsafe(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "onboarding_test_user"',
    );
    await client.$executeRawUnsafe(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "onboarding_test_user"',
    );
    await client.$executeRawUnsafe(
      'REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM "onboarding_test_user"',
    );
  } finally {
    await client.$disconnect();
  }
}

export default prepareIntegrationDatabase;

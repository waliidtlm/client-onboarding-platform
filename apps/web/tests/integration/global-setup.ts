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

function quotedDatabaseRole(connectionString: string, label: string): string {
  const role = decodeURIComponent(new URL(connectionString).username);
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`${label} must contain a safe PostgreSQL role`);
  }
  return `"${role}"`;
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
  const testRuntimeRole = quotedDatabaseRole(testRuntimeUrl, "TEST_DATABASE_URL");
  const testStaffPassword = process.env.TEST_STAFF_PASSWORD;
  if (!testStaffPassword) {
    throw new Error("TEST_STAFF_PASSWORD is required for isolated integration data");
  }

  const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
  const executable = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const preserveDatabase = process.env.INTEGRATION_PRESERVE_DATABASE === "1";
  const databaseCommand = preserveDatabase
    ? "pnpm.cmd prisma migrate deploy --config prisma.test.config.ts"
    : "pnpm.cmd db:reset:test";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", databaseCommand]
      : preserveDatabase
        ? ["prisma", "migrate", "deploy", "--config", "prisma.test.config.ts"]
        : ["db:reset:test"];
  const databasePreparation = spawnSync(executable, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: "utf8",
  });

  if (databasePreparation.status !== 0) {
    throw new Error(
      `Test database preparation failed: ${
        databasePreparation.error?.message ??
        databasePreparation.stderr ??
        databasePreparation.stdout ??
        "unknown error"
      }`,
    );
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testMigrationUrl }),
  });

  try {
    await seedDatabase(client, testStaffPassword);
    await client.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${testRuntimeRole}`);
    await client.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${testRuntimeRole}`,
    );
    await client.$executeRawUnsafe(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${testRuntimeRole}`,
    );
    await client.$executeRawUnsafe(
      `REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM ${testRuntimeRole}`,
    );
  } finally {
    await client.$disconnect();
  }
}

export default prepareIntegrationDatabase;

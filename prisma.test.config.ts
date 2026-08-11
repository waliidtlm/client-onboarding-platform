import "dotenv/config";

import { defineConfig } from "prisma/config";

function databaseName(value: string): string {
  return new URL(value).pathname.replace(/^\//, "");
}

const testMigrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;
const testDatabaseName = process.env.TEST_DB_NAME ?? "onboarding_test";
const shadowDatabaseName = process.env.SHADOW_DB_NAME ?? "onboarding_shadow";

if (
  !/^onboarding_test(?:_[a-z0-9_]+)?$/.test(testDatabaseName) ||
  !testMigrationUrl ||
  databaseName(testMigrationUrl) !== testDatabaseName
) {
  throw new Error("Test migration setup requires the explicitly named onboarding_test database");
}

if (
  !/^onboarding_shadow(?:_[a-z0-9_]+)?$/.test(shadowDatabaseName) ||
  !shadowDatabaseUrl ||
  databaseName(shadowDatabaseUrl) !== shadowDatabaseName
) {
  throw new Error("Test migration checks require an explicitly named onboarding_shadow database");
}

export default defineConfig({
  schema: "apps/web/prisma/schema.prisma",
  migrations: {
    path: "apps/web/prisma/migrations",
  },
  datasource: {
    url: testMigrationUrl,
    shadowDatabaseUrl,
  },
});

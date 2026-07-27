import "dotenv/config";

import { defineConfig } from "prisma/config";

function databaseName(value: string): string {
  return new URL(value).pathname.replace(/^\//, "");
}

const testMigrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

if (!testMigrationUrl || databaseName(testMigrationUrl) !== "onboarding_test") {
  throw new Error("Destructive test setup requires onboarding_test");
}

if (!shadowDatabaseUrl || databaseName(shadowDatabaseUrl) !== "onboarding_shadow") {
  throw new Error("Test migration checks require onboarding_shadow");
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

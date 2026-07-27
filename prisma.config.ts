import "dotenv/config";

import { defineConfig } from "prisma/config";

function databaseName(value: string): string {
  return new URL(value).pathname.replace(/^\//, "");
}

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
}

if (databaseName(databaseUrl) !== "onboarding_app") {
  throw new Error("Application migrations must target onboarding_app");
}

const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

if (shadowDatabaseUrl && databaseName(shadowDatabaseUrl) !== "onboarding_shadow") {
  throw new Error("SHADOW_DATABASE_URL must target onboarding_shadow");
}

export default defineConfig({
  schema: "apps/web/prisma/schema.prisma",
  migrations: {
    path: "apps/web/prisma/migrations",
    seed: "tsx apps/web/prisma/seed.ts",
  },
  datasource: {
    url: databaseUrl,
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});

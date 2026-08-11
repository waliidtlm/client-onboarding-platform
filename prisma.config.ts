import "dotenv/config";

import { defineConfig } from "prisma/config";

function databaseName(value: string): string {
  return new URL(value).pathname.replace(/^\//, "");
}

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
}

const targetDatabaseName = databaseName(databaseUrl);
const exactPhase7Demo =
  targetDatabaseName === "onboarding_phase7_demo" &&
  process.env.PHASE7_DEMO_FIXTURE_MARKER === "PHASE7_DEMO_FIXTURE_v1";
if (targetDatabaseName !== "onboarding_app" && !exactPhase7Demo) {
  throw new Error("Application migrations must target onboarding_app or the exact Phase 7 demo");
}

const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

if (
  shadowDatabaseUrl &&
  !exactPhase7Demo &&
  databaseName(shadowDatabaseUrl) !== "onboarding_shadow"
) {
  throw new Error("SHADOW_DATABASE_URL must target the matching isolated shadow database");
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

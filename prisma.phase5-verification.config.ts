import { defineConfig } from "prisma/config";

const databaseUrl = process.env.PHASE5_MIGRATION_DATABASE_URL;
if (
  !databaseUrl ||
  !/^\/onboarding_phase5_(?:verification|fresh_[0-9]{8})$/.test(new URL(databaseUrl).pathname)
) {
  throw new Error(
    "PHASE5_MIGRATION_DATABASE_URL must target the isolated Phase 5 verification namespace",
  );
}

export default defineConfig({
  schema: "apps/web/prisma/schema.prisma",
  migrations: {
    path: "apps/web/prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});

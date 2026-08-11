import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const repositoryEnvironment = path.resolve(import.meta.dirname, "../..", ".env");
if (existsSync(repositoryEnvironment)) {
  process.loadEnvFile(repositoryEnvironment);
}

const port = Number(process.env.PLAYWRIGHT_PORT ?? process.env.WEB_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;
const minioURL = `http://127.0.0.1:${process.env.MINIO_API_PORT ?? "9000"}`;
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = process.env.TEST_DB_NAME ?? "onboarding_test";
process.env.TEST_STAFF_PASSWORD ??= "fictional-playwright-staff-password-2026";

if (
  !/^onboarding_test(?:_[a-z0-9_]+)?$/.test(testDatabaseName) ||
  !testDatabaseUrl ||
  new URL(testDatabaseUrl).pathname !== `/${testDatabaseName}`
) {
  throw new Error("Playwright requires TEST_DATABASE_URL targeting the explicit test database");
}

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
    env: {
      AUTH_SECRET: process.env.AUTH_SECRET ?? "playwright-auth-secret-with-at-least-32-characters",
      AUTOMATION_HMAC_SECRET:
        process.env.AUTOMATION_HMAC_SECRET ?? "playwright-automation-hmac-secret-000000",
      AUTOMATION_SERVICE_TOKEN:
        process.env.AUTOMATION_SERVICE_TOKEN ?? "playwright-automation-service-token-000000",
      AUTOMATION_PHASE5_SERVICE_TOKEN:
        process.env.AUTOMATION_PHASE5_SERVICE_TOKEN ?? "playwright-phase5-service-token-000000000",
      AUTOMATION_PHASE5_HMAC_SECRET:
        process.env.AUTOMATION_PHASE5_HMAC_SECRET ?? "playwright-phase5-hmac-secret-00000000000",
      AUTOMATION_PHASE6_SERVICE_TOKEN:
        process.env.AUTOMATION_PHASE6_SERVICE_TOKEN ?? "playwright-phase6-service-token-000000000",
      AUTOMATION_PHASE6_HMAC_SECRET:
        process.env.AUTOMATION_PHASE6_HMAC_SECRET ?? "playwright-phase6-hmac-secret-00000000000",
      AUTOMATION_PHASE7_SERVICE_TOKEN:
        process.env.AUTOMATION_PHASE7_SERVICE_TOKEN ?? "playwright-phase7-service-token-000000000",
      AUTOMATION_PHASE7_HMAC_SECRET:
        process.env.AUTOMATION_PHASE7_HMAC_SECRET ?? "playwright-phase7-hmac-secret-00000000000",
      CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION:
        process.env.CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION ?? "1",
      CLIENT_ACCESS_SIGNING_KEYS:
        process.env.CLIENT_ACCESS_SIGNING_KEYS ??
        '{"1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
      CLIENT_ACCESS_PUBLIC_BASE_URL: `${baseURL}/client-access`,
      APP_PUBLIC_ORIGIN: baseURL,
      CLIENT_SESSION_SECRET:
        process.env.CLIENT_SESSION_SECRET ?? "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      PUBLIC_RATE_LIMIT_HMAC_SECRET:
        process.env.PUBLIC_RATE_LIMIT_HMAC_SECRET ?? "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      TRUSTED_PROXY_HOPS: "0",
      CLIENT_SUPPORT_CONTACT: process.env.CLIENT_SUPPORT_CONTACT ?? "support@example.com",
      OBJECT_STORAGE_INTERNAL_ENDPOINT: minioURL,
      OBJECT_STORAGE_BROWSER_ENDPOINT: minioURL,
      OBJECT_STORAGE_BUCKET: process.env.OBJECT_STORAGE_BUCKET ?? "onboarding-files",
      OBJECT_STORAGE_ACCESS_KEY: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "playwright-storage",
      OBJECT_STORAGE_SECRET_KEY:
        process.env.OBJECT_STORAGE_SECRET_KEY ?? "playwright-storage-secret-000000000",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: process.env.SMTP_PORT ?? "1025",
      DATABASE_URL: testDatabaseUrl,
      LOG_LEVEL: "silent",
      NEXTAUTH_URL: baseURL,
      DEPLOYMENT_PROFILE: "local",
    },
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

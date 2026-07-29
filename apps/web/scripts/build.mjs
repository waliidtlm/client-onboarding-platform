import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const buildOnlyEnvironment = {
  DATABASE_URL: "postgresql://build-only@127.0.0.1:5432/onboarding_app",
  AUTH_SECRET: "build-only-placeholder-not-used-at-runtime",
  AUTOMATION_SERVICE_TOKEN: "build-only-automation-token-not-used-runtime",
  AUTOMATION_HMAC_SECRET: "build-only-automation-hmac-not-used-runtime",
  AUTOMATION_PHASE5_SERVICE_TOKEN: "build-only-phase5-service-token-not-runtime",
  AUTOMATION_PHASE6_SERVICE_TOKEN: "build-only-phase6-service-token-not-runtime",
  AUTOMATION_PHASE6_HMAC_SECRET: "build-only-phase6-hmac-secret-not-runtime",
  AUTOMATION_PHASE5_HMAC_SECRET: "build-only-phase5-hmac-secret-not-runtime",
  CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION: "1",
  CLIENT_ACCESS_SIGNING_KEYS: '{"1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
  CLIENT_ACCESS_PUBLIC_BASE_URL: "http://127.0.0.1:3000/client-access",
  APP_PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  CLIENT_SESSION_SECRET: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  PUBLIC_RATE_LIMIT_HMAC_SECRET: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  CLIENT_SUPPORT_CONTACT: "support@example.com",
  OBJECT_STORAGE_INTERNAL_ENDPOINT: "http://127.0.0.1:9000",
  OBJECT_STORAGE_BROWSER_ENDPOINT: "http://127.0.0.1:9000",
  OBJECT_STORAGE_BUCKET: "build-only-files",
  OBJECT_STORAGE_ACCESS_KEY: "build-only-storage",
  OBJECT_STORAGE_SECRET_KEY: "build-only-storage-secret-0000000000",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  NEXTAUTH_URL: "http://127.0.0.1:3000",
};

const nextCli = fileURLToPath(import.meta.resolve("next/dist/bin/next"));
const result = spawnSync(process.execPath, [nextCli, "build"], {
  env: { ...process.env, ...buildOnlyEnvironment },
  stdio: "inherit",
});

process.exit(result.status ?? 1);

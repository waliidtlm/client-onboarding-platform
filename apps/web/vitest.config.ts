import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(projectRoot, "src"),
    },
  },
  test: {
    env: {
      AUTOMATION_HMAC_SECRET: "unit-test-automation-hmac-secret-000000",
      AUTOMATION_SERVICE_TOKEN: "unit-test-automation-service-token-000000",
      AUTOMATION_PHASE5_SERVICE_TOKEN: "unit-test-phase5-service-token-00000000",
      AUTOMATION_PHASE5_HMAC_SECRET: "unit-test-phase5-hmac-secret-0000000000",
      AUTOMATION_PHASE6_SERVICE_TOKEN: "unit-test-phase6-service-token-00000000",
      AUTOMATION_PHASE6_HMAC_SECRET: "unit-test-phase6-hmac-secret-0000000000",
      AUTH_SECRET: "unit-test-auth-secret-with-at-least-32-characters",
      CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION: "1",
      CLIENT_ACCESS_SIGNING_KEYS: '{"1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
      CLIENT_ACCESS_PUBLIC_BASE_URL: "http://127.0.0.1:3100/client-access",
      APP_PUBLIC_ORIGIN: "http://127.0.0.1:3100",
      CLIENT_SESSION_SECRET: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      PUBLIC_RATE_LIMIT_HMAC_SECRET: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      CLIENT_SUPPORT_CONTACT: "support@example.com",
      OBJECT_STORAGE_INTERNAL_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_BROWSER_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_BUCKET: "unit-test-files",
      OBJECT_STORAGE_ACCESS_KEY: "unit-test-storage",
      OBJECT_STORAGE_SECRET_KEY: "unit-test-storage-secret-00000000",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      DATABASE_URL: "postgresql://unit_test:unit_test@127.0.0.1:5432/unit_test",
      NEXTAUTH_URL: "http://127.0.0.1:3100",
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
});

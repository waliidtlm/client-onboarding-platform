import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "@/lib/env";

const validDatabaseUrl = [
  "postgresql:",
  "//app_user:fake-password",
  "@127.0.0.1:5432/onboarding_app",
].join("");

const automationEnvironment = {
  AUTOMATION_HMAC_SECRET: "test-automation-hmac-secret-000000000",
  AUTOMATION_SERVICE_TOKEN: "test-automation-service-token-000000",
  AUTOMATION_PHASE5_SERVICE_TOKEN: "test-phase5-service-token-00000000000",
  AUTOMATION_PHASE5_HMAC_SECRET: "test-phase5-hmac-secret-000000000000",
  AUTOMATION_PHASE6_SERVICE_TOKEN: "test-phase6-service-token-00000000000",
  AUTOMATION_PHASE6_HMAC_SECRET: "test-phase6-hmac-secret-000000000000",
  CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION: "1",
  CLIENT_ACCESS_SIGNING_KEYS: '{"1":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}',
  CLIENT_ACCESS_PUBLIC_BASE_URL: "http://127.0.0.1:3100/client-access",
  APP_PUBLIC_ORIGIN: "http://127.0.0.1:3100",
  CLIENT_SESSION_SECRET: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  PUBLIC_RATE_LIMIT_HMAC_SECRET: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  CLIENT_SUPPORT_CONTACT: "support@example.com",
  OBJECT_STORAGE_INTERNAL_ENDPOINT: "http://127.0.0.1:9000",
  OBJECT_STORAGE_BROWSER_ENDPOINT: "http://127.0.0.1:9000",
  OBJECT_STORAGE_BUCKET: "test-files",
  OBJECT_STORAGE_ACCESS_KEY: "test-storage",
  OBJECT_STORAGE_SECRET_KEY: "test-storage-secret-000000000000",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
};

describe("parseServerEnvironment", () => {
  it("accepts valid PostgreSQL configuration", () => {
    const environment = parseServerEnvironment({
      ...automationEnvironment,
      AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
      DATABASE_URL: validDatabaseUrl,
      LOG_LEVEL: "debug",
      NEXTAUTH_URL: "http://127.0.0.1:3100",
    });

    expect(environment).toEqual({
      ...automationEnvironment,
      CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION: 1,
      CLIENT_ACCESS_SIGNING_KEYS: {
        "1": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      CLIENT_ACCESS_TOKEN_DAYS: 30,
      TRUSTED_PROXY_HOPS: 0,
      AGENCY_NAME: "Northstar Growth Agency",
      OBJECT_STORAGE_REGION: "us-east-1",
      SMTP_PORT: 1025,
      AUTOMATION_LEASE_SECONDS: 300,
      AUTOMATION_MAX_ATTEMPTS: 5,
      AUTOMATION_RETRY_BASE_SECONDS: 30,
      AUTOMATION_SIGNATURE_MAX_AGE_SECONDS: 300,
      AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
      DATABASE_URL: validDatabaseUrl,
      LOG_LEVEL: "debug",
      NEXTAUTH_URL: "http://127.0.0.1:3100",
      PROVISIONING_TASK_MAX_ATTEMPTS: 3,
    });
  });

  it("applies the default log level", () => {
    const environment = parseServerEnvironment({
      ...automationEnvironment,
      AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
      DATABASE_URL: validDatabaseUrl,
      NEXTAUTH_URL: "http://127.0.0.1:3100",
    });

    expect(environment.LOG_LEVEL).toBe("info");
  });

  it("rejects a missing database URL", () => {
    expect(() => parseServerEnvironment({})).toThrow();
  });

  it("rejects a non-PostgreSQL URL", () => {
    expect(() =>
      parseServerEnvironment({
        ...automationEnvironment,
        AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
        DATABASE_URL: "https://example.test/database",
        NEXTAUTH_URL: "http://127.0.0.1:3100",
      }),
    ).toThrow();
  });

  it("rejects a short authentication secret", () => {
    expect(() =>
      parseServerEnvironment({
        ...automationEnvironment,
        AUTH_SECRET: "too-short",
        DATABASE_URL: validDatabaseUrl,
        NEXTAUTH_URL: "http://127.0.0.1:3100",
      }),
    ).toThrow();
  });

  it("rejects shared worker and public hashing credentials", () => {
    const base = {
      ...automationEnvironment,
      AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
      DATABASE_URL: validDatabaseUrl,
      NEXTAUTH_URL: "http://127.0.0.1:3100",
    };
    expect(() =>
      parseServerEnvironment({
        ...base,
        AUTOMATION_PHASE5_SERVICE_TOKEN: base.AUTOMATION_SERVICE_TOKEN,
      }),
    ).toThrow();
    expect(() =>
      parseServerEnvironment({
        ...base,
        AUTOMATION_PHASE5_HMAC_SECRET: base.AUTOMATION_HMAC_SECRET,
      }),
    ).toThrow();
    expect(() =>
      parseServerEnvironment({
        ...base,
        PUBLIC_RATE_LIMIT_HMAC_SECRET: base.CLIENT_SESSION_SECRET,
      }),
    ).toThrow();
  });
});

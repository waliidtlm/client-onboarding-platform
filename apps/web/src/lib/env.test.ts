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
});

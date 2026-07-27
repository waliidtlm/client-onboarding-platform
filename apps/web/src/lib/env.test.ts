import { describe, expect, it } from "vitest";

import { parseServerEnvironment } from "@/lib/env";

const validDatabaseUrl = [
  "postgresql:",
  "//app_user:fake-password",
  "@127.0.0.1:5432/onboarding_app",
].join("");

describe("parseServerEnvironment", () => {
  it("accepts valid PostgreSQL configuration", () => {
    const environment = parseServerEnvironment({
      AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
      DATABASE_URL: validDatabaseUrl,
      LOG_LEVEL: "debug",
      NEXTAUTH_URL: "http://127.0.0.1:3100",
    });

    expect(environment).toEqual({
      AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
      DATABASE_URL: validDatabaseUrl,
      LOG_LEVEL: "debug",
      NEXTAUTH_URL: "http://127.0.0.1:3100",
    });
  });

  it("applies the default log level", () => {
    const environment = parseServerEnvironment({
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
        AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
        DATABASE_URL: "https://example.test/database",
        NEXTAUTH_URL: "http://127.0.0.1:3100",
      }),
    ).toThrow();
  });

  it("rejects a short authentication secret", () => {
    expect(() =>
      parseServerEnvironment({
        AUTH_SECRET: "too-short",
        DATABASE_URL: validDatabaseUrl,
        NEXTAUTH_URL: "http://127.0.0.1:3100",
      }),
    ).toThrow();
  });
});

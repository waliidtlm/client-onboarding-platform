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
      DATABASE_URL: validDatabaseUrl,
      LOG_LEVEL: "debug",
    });

    expect(environment).toEqual({
      DATABASE_URL: validDatabaseUrl,
      LOG_LEVEL: "debug",
    });
  });

  it("applies the default log level", () => {
    const environment = parseServerEnvironment({
      DATABASE_URL: validDatabaseUrl,
    });

    expect(environment.LOG_LEVEL).toBe("info");
  });

  it("rejects a missing database URL", () => {
    expect(() => parseServerEnvironment({})).toThrow();
  });

  it("rejects a non-PostgreSQL URL", () => {
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "https://example.test/database",
      }),
    ).toThrow();
  });
});

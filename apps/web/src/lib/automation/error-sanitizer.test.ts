import { describe, expect, it } from "vitest";
import { sanitizeAutomationError } from "@/lib/automation/error-sanitizer";

describe("sanitizeAutomationError", () => {
  it("redacts credential-shaped content and control characters", () => {
    const result = sanitizeAutomationError(
      "Provider failed\nAuthorization: Bearer abc.def token=secret-value\u0001",
    );
    expect(result).not.toContain("abc.def");
    expect(result).not.toContain("secret-value");
    expect(result).toContain("[REDACTED]");
  });
});

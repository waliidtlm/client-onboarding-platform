import { describe, expect, it } from "vitest";
import {
  automationRunIdempotencyKey,
  canonicalizeJson,
  normalizedJsonEqual,
  onboardingActivatedDeduplicationKey,
} from "@/domain/automation/idempotency";

describe("automation identifiers and canonical JSON", () => {
  it("creates separate event and run identifiers", () => {
    expect(onboardingActivatedDeduplicationKey("onb")).toBe("ONBOARDING_ACTIVATED:onb:v1");
    expect(automationRunIdempotencyKey("evt", 2)).toBe("AUTOMATION_RUN:evt:attempt:2");
  });

  it("normalizes object property order recursively", () => {
    const left = { b: 2, a: { z: true, x: ["a", "b"] } };
    const right = { a: { x: ["a", "b"], z: true }, b: 2 };
    expect(canonicalizeJson(left)).toBe(canonicalizeJson(right));
    expect(normalizedJsonEqual(left, right)).toBe(true);
    expect(normalizedJsonEqual(left, { ...right, b: 3 })).toBe(false);
  });
});

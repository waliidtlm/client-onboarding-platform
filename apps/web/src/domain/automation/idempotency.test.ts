import { describe, expect, it } from "vitest";
import {
  automationRunIdempotencyKey,
  automationEventPayloadIsValid,
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

  it("validates identifiers-only Phase 4 payloads", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(automationEventPayloadIsValid("ONBOARDING_ACTIVATED", {})).toBe(true);
    expect(automationEventPayloadIsValid("PROVISIONING_TASK_REQUESTED", { taskId: id })).toBe(true);
    expect(automationEventPayloadIsValid("WELCOME_EMAIL_REQUESTED", { notificationId: id })).toBe(
      true,
    );
    expect(automationEventPayloadIsValid("PROVISIONING_TASK_REQUESTED", {})).toBe(false);
  });
});

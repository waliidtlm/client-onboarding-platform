import { describe, expect, it } from "vitest";
import { AutomationEventStatus, AutomationFailureClassification } from "@/generated/prisma/client";
import { failureTargetStatus, nextAutomationEventStatus } from "@/domain/automation/event-state";

describe("automation event transitions", () => {
  it.each([
    ["PENDING", "CLAIM", "PROCESSING"],
    ["PROCESSING", "COMPLETE", "COMPLETED"],
    ["PROCESSING", "TRANSIENT_FAILURE", "PENDING"],
    ["PROCESSING", "OPERATOR_FAILURE", "FAILED"],
    ["PROCESSING", "PERMANENT_FAILURE", "DEAD_LETTER"],
    ["PROCESSING", "LEASE_EXPIRED", "PENDING"],
    ["FAILED", "MANUAL_RETRY", "PENDING"],
    ["DEAD_LETTER", "MANUAL_RETRY", "PENDING"],
    ["COMPLETED", "MANUAL_RETRY", null],
    ["PENDING", "COMPLETE", null],
  ] as const)("%s + %s -> %s", (current, action, expected) => {
    expect(nextAutomationEventStatus(current as AutomationEventStatus, action)).toBe(expected);
  });

  it.each([
    [AutomationFailureClassification.RETRYABLE, 1, 5, AutomationEventStatus.PENDING],
    [AutomationFailureClassification.OPERATOR_REMEDIABLE, 1, 5, AutomationEventStatus.FAILED],
    [AutomationFailureClassification.PERMANENT, 1, 5, AutomationEventStatus.DEAD_LETTER],
    [AutomationFailureClassification.RETRYABLE, 5, 5, AutomationEventStatus.DEAD_LETTER],
  ])("maps failure %s at %i/%i to %s", (classification, attempt, max, expected) => {
    expect(
      failureTargetStatus({
        classification,
        attemptCount: attempt,
        maxAttempts: max,
      }),
    ).toBe(expected);
  });
});

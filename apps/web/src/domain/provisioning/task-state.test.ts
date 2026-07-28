import { describe, expect, it } from "vitest";
import {
  nextProvisioningTaskStatus,
  providerFailureTarget,
} from "@/domain/provisioning/task-state";

describe("provisioning task state", () => {
  it.each([
    ["PENDING", "START", "IN_PROGRESS"],
    ["FAILED", "START", "IN_PROGRESS"],
    ["IN_PROGRESS", "COMPLETE", "COMPLETED"],
    ["IN_PROGRESS", "RETRYABLE_FAILURE", "PENDING"],
    ["IN_PROGRESS", "PERMANENT_FAILURE", "MANUAL_REVIEW_REQUIRED"],
    ["MANUAL_REVIEW_REQUIRED", "AUTHORIZE_RETRY", "FAILED"],
    ["MANUAL_REVIEW_REQUIRED", "MANUAL_ACCEPT", "MANUALLY_ACCEPTED"],
  ] as const)("%s + %s becomes %s", (current, action, expected) => {
    expect(nextProvisioningTaskStatus(current, action)).toBe(expected);
  });

  it("moves exhausted retryable failures to manual review", () => {
    expect(providerFailureTarget({ retryable: true, attemptCount: 2, maxAttempts: 3 })).toBe(
      "PENDING",
    );
    expect(providerFailureTarget({ retryable: true, attemptCount: 3, maxAttempts: 3 })).toBe(
      "MANUAL_REVIEW_REQUIRED",
    );
  });
});

import { describe, expect, it } from "vitest";
import { AutomationFailureClassification } from "@/generated/prisma/client";
import { classifyAutomationFailure, retryDelaySeconds } from "@/domain/automation/retry-policy";

describe("automation retry policy", () => {
  it.each([
    [1, 30],
    [2, 60],
    [3, 120],
    [4, 240],
    [5, 240],
  ])("backs off attempt %i by %i seconds", (attempt, seconds) => {
    expect(retryDelaySeconds(attempt)).toBe(seconds);
  });

  it.each([
    ["NETWORK_TIMEOUT", AutomationFailureClassification.RETRYABLE],
    ["MISSING_BUSINESS_CONFIGURATION", AutomationFailureClassification.OPERATOR_REMEDIABLE],
    ["INVALID_BUSINESS_STATE", AutomationFailureClassification.OPERATOR_REMEDIABLE],
    ["INVALID_EVENT_SCHEMA", AutomationFailureClassification.PERMANENT],
    ["UNSUPPORTED_EVENT_TYPE", AutomationFailureClassification.PERMANENT],
    ["UNKNOWN_FAILURE", AutomationFailureClassification.PERMANENT],
  ])("classifies %s as %s", (code, expected) => {
    expect(classifyAutomationFailure(code)).toBe(expected);
  });
});

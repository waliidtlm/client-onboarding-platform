import { AutomationFailureClassification } from "@/generated/prisma/client";

const retryableCodes = new Set([
  "NETWORK_TIMEOUT",
  "RATE_LIMITED",
  "TEMPORARY_PROVIDER_FAILURE",
  "UPSTREAM_5XX",
]);

const operatorRemediableCodes = new Set([
  "INVALID_BUSINESS_STATE",
  "MISSING_BUSINESS_CONFIGURATION",
  "OPERATIONAL_HOLD",
]);

const permanentCodes = new Set([
  "INVALID_EVENT_INTEGRITY",
  "INVALID_EVENT_SCHEMA",
  "UNSUPPORTED_EVENT_TYPE",
]);

export function classifyAutomationFailure(errorCode: string): AutomationFailureClassification {
  if (retryableCodes.has(errorCode)) {
    return AutomationFailureClassification.RETRYABLE;
  }
  if (operatorRemediableCodes.has(errorCode)) {
    return AutomationFailureClassification.OPERATOR_REMEDIABLE;
  }
  if (permanentCodes.has(errorCode)) {
    return AutomationFailureClassification.PERMANENT;
  }
  return AutomationFailureClassification.PERMANENT;
}

export function retryDelaySeconds(attemptCount: number, baseSeconds = 30): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 3));
  return Math.min(baseSeconds * 2 ** exponent, 240);
}

export function retryAvailableAt(now: Date, attemptCount: number, baseSeconds = 30): Date {
  return new Date(now.getTime() + retryDelaySeconds(attemptCount, baseSeconds) * 1_000);
}

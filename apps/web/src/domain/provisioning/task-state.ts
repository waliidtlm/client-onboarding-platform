import type { ProvisioningTaskStatus } from "@/generated/prisma/client";

export type ProvisioningTaskAction =
  | "START"
  | "COMPLETE"
  | "RETRYABLE_FAILURE"
  | "PERMANENT_FAILURE"
  | "AUTHORIZE_RETRY"
  | "MANUAL_ACCEPT";

const transitions: Readonly<
  Record<
    ProvisioningTaskStatus,
    Readonly<Partial<Record<ProvisioningTaskAction, ProvisioningTaskStatus>>>
  >
> = {
  PENDING: { START: "IN_PROGRESS" },
  IN_PROGRESS: {
    COMPLETE: "COMPLETED",
    RETRYABLE_FAILURE: "PENDING",
    PERMANENT_FAILURE: "MANUAL_REVIEW_REQUIRED",
  },
  COMPLETED: {},
  FAILED: { START: "IN_PROGRESS" },
  MANUAL_REVIEW_REQUIRED: {
    AUTHORIZE_RETRY: "FAILED",
    MANUAL_ACCEPT: "MANUALLY_ACCEPTED",
  },
  MANUALLY_ACCEPTED: {},
};

export function nextProvisioningTaskStatus(
  current: ProvisioningTaskStatus,
  action: ProvisioningTaskAction,
): ProvisioningTaskStatus | null {
  return transitions[current][action] ?? null;
}

export function providerFailureTarget(
  input: Readonly<{
    retryable: boolean;
    attemptCount: number;
    maxAttempts: number;
  }>,
): "PENDING" | "MANUAL_REVIEW_REQUIRED" {
  return input.retryable && input.attemptCount < input.maxAttempts
    ? "PENDING"
    : "MANUAL_REVIEW_REQUIRED";
}

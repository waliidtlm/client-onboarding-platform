import { AutomationEventStatus, AutomationFailureClassification } from "@/generated/prisma/client";

export type AutomationEventAction =
  | "CLAIM"
  | "COMPLETE"
  | "TRANSIENT_FAILURE"
  | "OPERATOR_FAILURE"
  | "PERMANENT_FAILURE"
  | "LEASE_EXPIRED"
  | "MANUAL_RETRY";

const transitions: Readonly<
  Record<
    AutomationEventStatus,
    Readonly<Partial<Record<AutomationEventAction, AutomationEventStatus>>>
  >
> = {
  [AutomationEventStatus.PENDING]: {
    CLAIM: AutomationEventStatus.PROCESSING,
  },
  [AutomationEventStatus.PROCESSING]: {
    COMPLETE: AutomationEventStatus.COMPLETED,
    TRANSIENT_FAILURE: AutomationEventStatus.PENDING,
    OPERATOR_FAILURE: AutomationEventStatus.FAILED,
    PERMANENT_FAILURE: AutomationEventStatus.DEAD_LETTER,
    LEASE_EXPIRED: AutomationEventStatus.PENDING,
  },
  [AutomationEventStatus.COMPLETED]: {},
  [AutomationEventStatus.FAILED]: {
    MANUAL_RETRY: AutomationEventStatus.PENDING,
  },
  [AutomationEventStatus.DEAD_LETTER]: {
    MANUAL_RETRY: AutomationEventStatus.PENDING,
  },
};

export function nextAutomationEventStatus(
  current: AutomationEventStatus,
  action: AutomationEventAction,
): AutomationEventStatus | null {
  return transitions[current][action] ?? null;
}

export function failureTargetStatus(
  input: Readonly<{
    classification: AutomationFailureClassification;
    attemptCount: number;
    maxAttempts: number;
  }>,
): AutomationEventStatus {
  if (input.attemptCount >= input.maxAttempts) {
    return AutomationEventStatus.DEAD_LETTER;
  }
  if (input.classification === AutomationFailureClassification.RETRYABLE) {
    return AutomationEventStatus.PENDING;
  }
  if (input.classification === AutomationFailureClassification.OPERATOR_REMEDIABLE) {
    return AutomationEventStatus.FAILED;
  }
  return AutomationEventStatus.DEAD_LETTER;
}

export function canLoadAutomationContext(
  input: Readonly<{
    eventStatus: AutomationEventStatus;
    runIsCurrent: boolean;
    runStatus: string;
    leaseExpiresAt: Date | null;
    now: Date;
  }>,
): boolean {
  return (
    input.eventStatus === AutomationEventStatus.PROCESSING &&
    input.runIsCurrent &&
    input.runStatus === "PROCESSING" &&
    input.leaseExpiresAt !== null &&
    input.leaseExpiresAt.getTime() > input.now.getTime()
  );
}

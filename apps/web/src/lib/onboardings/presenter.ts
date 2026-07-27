import type {
  ActivationRequirementStatus,
  CommercialGateStatus,
  OnboardingStatus,
} from "@/generated/prisma/client";

export type StoredStatus = Readonly<{
  status: OnboardingStatus;
  commercialGateStatus: CommercialGateStatus;
  activationRequirementStatus: ActivationRequirementStatus;
}>;

export function presentStoredStatus(value: StoredStatus): {
  currentBlocker: string;
  nextAction: string;
} {
  if (value.activationRequirementStatus === "NOT_SATISFIED") {
    return {
      currentBlocker: "Waiting for activation requirement",
      nextAction: "Continue commercial processing",
    };
  }

  if (value.activationRequirementStatus === "MANUAL_REVIEW_REQUIRED") {
    return {
      currentBlocker: "Activation requirement needs review",
      nextAction: "Review the stored commercial information",
    };
  }

  if (value.commercialGateStatus === "BLOCKED") {
    return {
      currentBlocker: "Commercial Gate is blocked",
      nextAction: "Review the stored commercial information",
    };
  }

  return {
    currentBlocker: "No blocker recorded",
    nextAction: "Review the onboarding record",
  };
}

export function formatMoney(amount: { toFixed(fractionDigits: number): string }, currency: string) {
  return `${currency} ${amount.toFixed(2)}`;
}

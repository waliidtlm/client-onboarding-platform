import type {
  ActivationRequirementStatus,
  CommercialGateBlocker,
  CommercialGateStatus,
  OnboardingStatus,
  SalesHandoffStatus,
} from "@/generated/prisma/client";

export type StoredStatus = Readonly<{
  status: OnboardingStatus;
  commercialGateStatus: CommercialGateStatus;
  activationRequirementStatus: ActivationRequirementStatus;
  salesHandoffStatus?: SalesHandoffStatus;
  commercialGateBlockingReasons?: readonly CommercialGateBlocker[];
  activationInvoiceReady?: boolean;
}>;

export function presentStoredStatus(value: StoredStatus): {
  currentBlocker: string;
  nextAction: string;
} {
  if (value.salesHandoffStatus === "INCOMPLETE") {
    return {
      currentBlocker: "Sales handoff needs correction",
      nextAction: "Sales must correct the missing handoff information",
    };
  }

  if (
    value.commercialGateBlockingReasons?.includes("ACTIVATION_AMOUNT_NOT_SATISFIED") &&
    value.activationInvoiceReady === false
  ) {
    return {
      currentBlocker: "Waiting for Finance to issue the activation invoice",
      nextAction: "Finance must issue the draft activation invoice",
    };
  }

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

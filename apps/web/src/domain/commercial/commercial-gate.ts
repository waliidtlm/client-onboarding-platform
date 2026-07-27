import {
  ActivationRequirementStatus,
  CommercialGateBlocker,
  CommercialGateStatus,
  ContractStatus,
  DealStatus,
} from "@/generated/prisma/client";

export type CommercialGateInput = Readonly<{
  dealStatus: DealStatus | null;
  contractStatus: ContractStatus | null;
  activationRequirementStatus: ActivationRequirementStatus;
  hasBlockingPaymentReview: boolean;
  hasPendingCommercialException: boolean;
  isCancelled: boolean;
  evaluatedAt: Date;
}>;

export type CommercialGateResult = Readonly<{
  status: CommercialGateStatus;
  blockingReasons: readonly CommercialGateBlocker[];
  evaluatedAt: string;
}>;

export function calculateCommercialGate(input: CommercialGateInput): CommercialGateResult {
  const blockingReasons: CommercialGateBlocker[] = [];

  if (input.dealStatus !== DealStatus.CLOSED_WON) {
    blockingReasons.push(CommercialGateBlocker.DEAL_NOT_CLOSED_WON);
  }
  if (input.contractStatus !== ContractStatus.SIGNED) {
    blockingReasons.push(CommercialGateBlocker.CONTRACT_NOT_SIGNED);
  }
  if (input.activationRequirementStatus !== ActivationRequirementStatus.SATISFIED) {
    blockingReasons.push(CommercialGateBlocker.ACTIVATION_AMOUNT_NOT_SATISFIED);
  }
  if (input.hasBlockingPaymentReview) {
    blockingReasons.push(CommercialGateBlocker.PAYMENT_REVIEW_REQUIRED);
  }
  if (input.hasPendingCommercialException) {
    blockingReasons.push(CommercialGateBlocker.COMMERCIAL_EXCEPTION_PENDING);
  }
  if (input.isCancelled) {
    blockingReasons.push(CommercialGateBlocker.ONBOARDING_CANCELLED);
  }

  let status: CommercialGateStatus;
  if (input.isCancelled) {
    status = CommercialGateStatus.CANCELLED;
  } else if (blockingReasons.length === 0) {
    status = CommercialGateStatus.APPROVED;
  } else if (input.hasBlockingPaymentReview || input.hasPendingCommercialException) {
    status = CommercialGateStatus.PENDING_REVIEW;
  } else {
    status = CommercialGateStatus.BLOCKED;
  }

  return {
    status,
    blockingReasons,
    evaluatedAt: input.evaluatedAt.toISOString(),
  };
}

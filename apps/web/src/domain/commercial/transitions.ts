import { ContractStatus, OnboardingStatus } from "@/generated/prisma/client";

export type ContractTransition = Readonly<{
  allowed: boolean;
  createsVersion: boolean;
}>;

export function evaluateContractTransition(
  current: ContractStatus,
  target: ContractStatus,
): ContractTransition {
  if (current === target) return { allowed: true, createsVersion: false };

  const sameVersionTargets: Partial<Record<ContractStatus, readonly ContractStatus[]>> = {
    [ContractStatus.DRAFT]: [ContractStatus.PENDING_SIGNATURE, ContractStatus.CANCELLED],
    [ContractStatus.PENDING_SIGNATURE]: [
      ContractStatus.SIGNED,
      ContractStatus.REVISION_REQUESTED,
      ContractStatus.CANCELLED,
    ],
    [ContractStatus.REVISION_REQUESTED]: [ContractStatus.DRAFT],
  };

  if (sameVersionTargets[current]?.includes(target)) {
    return { allowed: true, createsVersion: false };
  }

  if (
    current === ContractStatus.SIGNED &&
    (target === ContractStatus.REVISION_REQUESTED || target === ContractStatus.CANCELLED)
  ) {
    return { allowed: true, createsVersion: true };
  }

  return { allowed: false, createsVersion: false };
}

export function canActivateOnboarding(status: OnboardingStatus): boolean {
  return (
    status === OnboardingStatus.COMMERCIAL_PENDING ||
    status === OnboardingStatus.READY_FOR_ONBOARDING
  );
}

export function canCancelOnboarding(status: OnboardingStatus): boolean {
  return (
    status === OnboardingStatus.SALES_HANDOFF_INCOMPLETE ||
    status === OnboardingStatus.COMMERCIAL_PENDING ||
    status === OnboardingStatus.READY_FOR_ONBOARDING ||
    status === OnboardingStatus.INTERNAL_REVIEW ||
    status === OnboardingStatus.CLIENT_AWAITING_ACTION ||
    status === OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE
  );
}

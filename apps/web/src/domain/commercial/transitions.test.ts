import { describe, expect, it } from "vitest";

import { ContractStatus, OnboardingStatus } from "@/generated/prisma/client";
import {
  canActivateOnboarding,
  canCancelOnboarding,
  evaluateContractTransition,
} from "@/domain/commercial/transitions";

describe("contract transitions", () => {
  it.each([
    ["DRAFT", "PENDING_SIGNATURE", true, false],
    ["PENDING_SIGNATURE", "SIGNED", true, false],
    ["PENDING_SIGNATURE", "REVISION_REQUESTED", true, false],
    ["REVISION_REQUESTED", "DRAFT", true, false],
    ["SIGNED", "REVISION_REQUESTED", true, true],
    ["SIGNED", "CANCELLED", true, true],
    ["SIGNED", "DRAFT", false, false],
    ["CANCELLED", "SIGNED", false, false],
  ] as const)("%s → %s", (current, target, allowed, createsVersion) => {
    expect(evaluateContractTransition(ContractStatus[current], ContractStatus[target])).toEqual({
      allowed,
      createsVersion,
    });
  });
});

describe("onboarding transitions", () => {
  it("allows activation only from commercial pending or as an idempotent repeat", () => {
    expect(canActivateOnboarding(OnboardingStatus.COMMERCIAL_PENDING)).toBe(true);
    expect(canActivateOnboarding(OnboardingStatus.READY_FOR_ONBOARDING)).toBe(true);
    expect(canActivateOnboarding(OnboardingStatus.SALES_HANDOFF_INCOMPLETE)).toBe(false);
  });

  it("limits Phase 2 cancellation states", () => {
    expect(canCancelOnboarding(OnboardingStatus.SALES_HANDOFF_INCOMPLETE)).toBe(true);
    expect(canCancelOnboarding(OnboardingStatus.COMMERCIAL_PENDING)).toBe(true);
    expect(canCancelOnboarding(OnboardingStatus.READY_FOR_ONBOARDING)).toBe(true);
    expect(canCancelOnboarding(OnboardingStatus.COMPLETED)).toBe(false);
  });
});

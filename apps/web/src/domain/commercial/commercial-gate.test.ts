import { describe, expect, it } from "vitest";

import {
  ActivationRequirementStatus,
  CommercialGateBlocker,
  CommercialGateStatus,
  ContractStatus,
  DealStatus,
} from "@/generated/prisma/client";
import { calculateCommercialGate } from "@/domain/commercial/commercial-gate";

const evaluatedAt = new Date("2026-07-27T12:00:00.000Z");

describe("Commercial Gate", () => {
  it("approves only the complete approved combination", () => {
    expect(
      calculateCommercialGate({
        dealStatus: DealStatus.CLOSED_WON,
        contractStatus: ContractStatus.SIGNED,
        activationRequirementStatus: ActivationRequirementStatus.SATISFIED,
        hasBlockingPaymentReview: false,
        hasPendingCommercialException: false,
        isCancelled: false,
        evaluatedAt,
      }),
    ).toEqual({
      status: CommercialGateStatus.APPROVED,
      blockingReasons: [],
      evaluatedAt: evaluatedAt.toISOString(),
    });
  });

  it("returns every blocker in stable approved order", () => {
    const result = calculateCommercialGate({
      dealStatus: DealStatus.OPEN,
      contractStatus: ContractStatus.DRAFT,
      activationRequirementStatus: ActivationRequirementStatus.NOT_SATISFIED,
      hasBlockingPaymentReview: true,
      hasPendingCommercialException: true,
      isCancelled: true,
      evaluatedAt,
    });

    expect(result.status).toBe(CommercialGateStatus.CANCELLED);
    expect(result.blockingReasons).toEqual([
      CommercialGateBlocker.DEAL_NOT_CLOSED_WON,
      CommercialGateBlocker.CONTRACT_NOT_SIGNED,
      CommercialGateBlocker.ACTIVATION_AMOUNT_NOT_SATISFIED,
      CommercialGateBlocker.PAYMENT_REVIEW_REQUIRED,
      CommercialGateBlocker.COMMERCIAL_EXCEPTION_PENDING,
      CommercialGateBlocker.ONBOARDING_CANCELLED,
    ]);
  });

  it("covers every blocker combination deterministically", () => {
    for (let mask = 0; mask < 64; mask += 1) {
      const first = calculateCommercialGate({
        dealStatus: mask & 1 ? DealStatus.OPEN : DealStatus.CLOSED_WON,
        contractStatus: mask & 2 ? ContractStatus.DRAFT : ContractStatus.SIGNED,
        activationRequirementStatus:
          mask & 4
            ? ActivationRequirementStatus.NOT_SATISFIED
            : ActivationRequirementStatus.SATISFIED,
        hasBlockingPaymentReview: Boolean(mask & 8),
        hasPendingCommercialException: Boolean(mask & 16),
        isCancelled: Boolean(mask & 32),
        evaluatedAt,
      });
      const second = calculateCommercialGate({
        dealStatus: mask & 1 ? DealStatus.OPEN : DealStatus.CLOSED_WON,
        contractStatus: mask & 2 ? ContractStatus.DRAFT : ContractStatus.SIGNED,
        activationRequirementStatus:
          mask & 4
            ? ActivationRequirementStatus.NOT_SATISFIED
            : ActivationRequirementStatus.SATISFIED,
        hasBlockingPaymentReview: Boolean(mask & 8),
        hasPendingCommercialException: Boolean(mask & 16),
        isCancelled: Boolean(mask & 32),
        evaluatedAt,
      });

      expect(first).toEqual(second);
      expect(first.status === CommercialGateStatus.APPROVED).toBe(mask === 0);
    }
  });
});

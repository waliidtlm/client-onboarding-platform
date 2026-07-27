import { describe, expect, it } from "vitest";

import { PaymentVerificationStatus } from "@/generated/prisma/client";
import { canReviewPayment, isTerminalPaymentDecision } from "@/domain/commercial/payment-review";

describe("payment review transitions", () => {
  it.each([
    ["PENDING", "VERIFIED", true],
    ["PENDING", "REVIEW_REQUIRED", true],
    ["PENDING", "REJECTED", true],
    ["REVIEW_REQUIRED", "VERIFIED", true],
    ["REVIEW_REQUIRED", "REJECTED", true],
    ["VERIFIED", "VERIFIED", true],
    ["VERIFIED", "REJECTED", false],
    ["REJECTED", "REJECTED", true],
    ["REJECTED", "VERIFIED", false],
  ] as const)("%s → %s is %s", (current, target, expected) => {
    expect(
      canReviewPayment(PaymentVerificationStatus[current], PaymentVerificationStatus[target]),
    ).toBe(expected);
  });

  it("identifies immutable terminal decisions", () => {
    expect(isTerminalPaymentDecision(PaymentVerificationStatus.VERIFIED)).toBe(true);
    expect(isTerminalPaymentDecision(PaymentVerificationStatus.REJECTED)).toBe(true);
    expect(isTerminalPaymentDecision(PaymentVerificationStatus.PENDING)).toBe(false);
  });
});

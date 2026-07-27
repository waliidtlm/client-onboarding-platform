import { describe, expect, it } from "vitest";

import { ActivationRequirementStatus, ActivationType, Prisma } from "@/generated/prisma/client";
import { calculateActivationRequirement } from "@/domain/commercial/activation-requirement";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("activation requirement", () => {
  it.each([
    [ActivationType.FULL_PAYMENT_PERCENTAGE, "100", "10000", "10000.0000"],
    [ActivationType.DEPOSIT_PERCENTAGE, "30", "10000", "3000.0000"],
    [ActivationType.FIXED_DEPOSIT_AMOUNT, "1250", "10000", "1250.0000"],
  ] as const)("calculates %s without floating point", (activationType, value, total, required) => {
    const result = calculateActivationRequirement({
      activationType,
      activationValue: decimal(value),
      agreedTotal: decimal(total),
      invoiceReady: true,
      verifiedAmounts: [decimal(required)],
      manualApprovalActive: false,
    });

    expect(result.requiredAmount?.toFixed(4)).toBe(required);
    expect(result.status).toBe(ActivationRequirementStatus.SATISFIED);
  });

  it("sums partial verified payments and accepts overpayment", () => {
    const result = calculateActivationRequirement({
      activationType: ActivationType.DEPOSIT_PERCENTAGE,
      activationValue: decimal("30"),
      agreedTotal: decimal("10000"),
      invoiceReady: true,
      verifiedAmounts: [decimal("2000"), decimal("1250")],
      manualApprovalActive: false,
    });

    expect(result.verifiedTotal.toFixed(4)).toBe("3250.0000");
    expect(result.requiredAmount?.toFixed(4)).toBe("3000.0000");
    expect(result.status).toBe(ActivationRequirementStatus.SATISFIED);
  });

  it("keeps a draft invoice unsatisfied", () => {
    const result = calculateActivationRequirement({
      activationType: ActivationType.DEPOSIT_PERCENTAGE,
      activationValue: decimal("30"),
      agreedTotal: decimal("10000"),
      invoiceReady: false,
      verifiedAmounts: [],
      manualApprovalActive: false,
    });

    expect(result.status).toBe(ActivationRequirementStatus.NOT_SATISFIED);
  });

  it("supports manual approval and revocation", () => {
    const base = {
      activationType: ActivationType.MANUAL_APPROVAL,
      activationValue: decimal("0"),
      agreedTotal: decimal("10000"),
      invoiceReady: true,
      verifiedAmounts: [],
    };

    expect(calculateActivationRequirement({ ...base, manualApprovalActive: false }).status).toBe(
      ActivationRequirementStatus.MANUAL_REVIEW_REQUIRED,
    );
    expect(calculateActivationRequirement({ ...base, manualApprovalActive: true }).status).toBe(
      ActivationRequirementStatus.SATISFIED,
    );
  });

  it("rejects ambiguous full-payment configuration", () => {
    const result = calculateActivationRequirement({
      activationType: ActivationType.FULL_PAYMENT_PERCENTAGE,
      activationValue: decimal("80"),
      agreedTotal: decimal("10000"),
      invoiceReady: true,
      verifiedAmounts: [decimal("10000")],
      manualApprovalActive: false,
    });

    expect(result.status).toBe(ActivationRequirementStatus.MANUAL_REVIEW_REQUIRED);
    expect(result.configurationError).toContain("exactly 100%");
  });
});

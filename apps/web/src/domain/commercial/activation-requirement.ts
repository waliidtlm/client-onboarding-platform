import { ActivationRequirementStatus, ActivationType, Prisma } from "@/generated/prisma/client";

export type ActivationRequirementInput = Readonly<{
  activationType: ActivationType;
  activationValue: Prisma.Decimal;
  agreedTotal: Prisma.Decimal;
  invoiceReady: boolean;
  verifiedAmounts: readonly Prisma.Decimal[];
  manualApprovalActive: boolean;
}>;

export type ActivationRequirementResult = Readonly<{
  requiredAmount: Prisma.Decimal | null;
  verifiedTotal: Prisma.Decimal;
  status: ActivationRequirementStatus;
  configurationError: string | null;
}>;

function money(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

export function calculateActivationRequirement(
  input: ActivationRequirementInput,
): ActivationRequirementResult {
  const verifiedTotal = money(
    input.verifiedAmounts.reduce((sum, amount) => sum.plus(amount), new Prisma.Decimal(0)),
  );

  let requiredAmount: Prisma.Decimal | null = null;
  let configurationError: string | null = null;

  if (input.agreedTotal.lte(0)) {
    configurationError = "The agreed total must be greater than zero.";
  } else {
    switch (input.activationType) {
      case ActivationType.FULL_PAYMENT_PERCENTAGE:
        if (!input.activationValue.equals(100)) {
          configurationError = "FULL_PAYMENT_PERCENTAGE must be configured as exactly 100%.";
        } else {
          requiredAmount = money(input.agreedTotal);
        }
        break;
      case ActivationType.DEPOSIT_PERCENTAGE:
        if (input.activationValue.lte(0) || input.activationValue.gt(100)) {
          configurationError = "Deposit percentage must be greater than 0 and no more than 100.";
        } else {
          requiredAmount = money(input.agreedTotal.mul(input.activationValue).div(100));
        }
        break;
      case ActivationType.FIXED_DEPOSIT_AMOUNT:
        if (input.activationValue.lte(0)) {
          configurationError = "Fixed deposit amount must be greater than zero.";
        } else {
          requiredAmount = money(input.activationValue);
        }
        break;
      case ActivationType.MANUAL_APPROVAL:
        if (!input.activationValue.equals(0)) {
          configurationError = "MANUAL_APPROVAL must use an activation value of zero.";
        }
        break;
    }
  }

  if (configurationError) {
    return {
      requiredAmount,
      verifiedTotal,
      status: ActivationRequirementStatus.MANUAL_REVIEW_REQUIRED,
      configurationError,
    };
  }

  if (!input.invoiceReady) {
    return {
      requiredAmount,
      verifiedTotal,
      status: ActivationRequirementStatus.NOT_SATISFIED,
      configurationError: null,
    };
  }

  if (input.activationType === ActivationType.MANUAL_APPROVAL) {
    return {
      requiredAmount: null,
      verifiedTotal,
      status: input.manualApprovalActive
        ? ActivationRequirementStatus.SATISFIED
        : ActivationRequirementStatus.MANUAL_REVIEW_REQUIRED,
      configurationError: null,
    };
  }

  return {
    requiredAmount,
    verifiedTotal,
    status:
      requiredAmount && verifiedTotal.gte(requiredAmount)
        ? ActivationRequirementStatus.SATISFIED
        : ActivationRequirementStatus.NOT_SATISFIED,
    configurationError: null,
  };
}

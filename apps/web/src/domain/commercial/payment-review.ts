import { PaymentVerificationStatus } from "@/generated/prisma/client";

export function canReviewPayment(
  current: PaymentVerificationStatus,
  target: PaymentVerificationStatus,
): boolean {
  if (
    current === PaymentVerificationStatus.VERIFIED ||
    current === PaymentVerificationStatus.REJECTED
  ) {
    return current === target;
  }

  if (current === PaymentVerificationStatus.PENDING) {
    return (
      target === PaymentVerificationStatus.VERIFIED ||
      target === PaymentVerificationStatus.REVIEW_REQUIRED ||
      target === PaymentVerificationStatus.REJECTED
    );
  }

  return (
    target === PaymentVerificationStatus.VERIFIED || target === PaymentVerificationStatus.REJECTED
  );
}

export function isTerminalPaymentDecision(status: PaymentVerificationStatus): boolean {
  return (
    status === PaymentVerificationStatus.VERIFIED || status === PaymentVerificationStatus.REJECTED
  );
}

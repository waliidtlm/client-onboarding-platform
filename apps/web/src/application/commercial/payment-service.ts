import {
  AuditActorType,
  InvoiceStatus,
  PaymentVerificationStatus,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { refreshCommercialState } from "@/application/commercial/commercial-gate-service";
import { recordPaymentSchema, reviewPaymentSchema } from "@/application/commercial/schemas";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
  type DatabaseClient,
} from "@/application/commercial/service-support";
import type { CommercialMutationResult } from "@/application/commercial/types";
import { canReviewPayment, isTerminalPaymentDecision } from "@/domain/commercial/payment-review";
import type { Result } from "@/domain/errors";

export async function recordPayment(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(recordPaymentSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.FINANCE]);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
          include: { activationInvoice: true },
        });
        if (!onboarding?.activationInvoice) {
          reject("NOT_FOUND", "The activation invoice does not exist.");
        }
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        const invoice = onboarding.activationInvoice;
        if (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.CANCELLED) {
          reject("INVALID_TRANSITION", "Payments cannot be recorded against this invoice.");
        }
        if (invoice.currency !== input.currency) {
          reject("INVALID_INPUT", "Payment currency must match the activation invoice.");
        }
        if (await tx.payment.findUnique({ where: { recordingKey: input.recordingKey } })) {
          reject("DUPLICATE_RECORDING_KEY", "This payment recording key is already in use.");
        }

        const payment = await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            originalAmount: new Prisma.Decimal(input.originalAmount),
            currency: input.currency,
            verificationStatus: PaymentVerificationStatus.PENDING,
            submittedById: input.actorId,
            externalReference: input.externalReference,
            recordingKey: input.recordingKey,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "PAYMENT_RECORDED",
          entityType: "PAYMENT",
          entityId: payment.id,
          newValue: {
            originalAmount: payment.originalAmount.toFixed(4),
            currency: payment.currency,
            verificationStatus: payment.verificationStatus,
          },
          correlationId: input.correlationId,
        });

        return refreshCommercialState(tx, {
          onboardingId: onboarding.id,
          correlationId: input.correlationId,
          triggeredByActorId: input.actorId,
          forceVersionIncrement: false,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function reviewPayment(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(reviewPaymentSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.FINANCE]);
        const onboarding = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
          include: { activationInvoice: true },
        });
        if (!onboarding?.activationInvoice) {
          reject("NOT_FOUND", "The activation invoice does not exist.");
        }
        if (onboarding.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
        if (!payment || payment.invoiceId !== onboarding.activationInvoice.id) {
          reject("NOT_FOUND", "The payment does not belong to this activation invoice.");
        }
        if (!canReviewPayment(payment.verificationStatus, input.decision)) {
          reject(
            "PAYMENT_DECISION_CONFLICT",
            "This payment already has a different terminal decision.",
          );
        }

        const verifiedAmount = input.verifiedAmount
          ? new Prisma.Decimal(input.verifiedAmount)
          : null;
        const identicalTerminal =
          isTerminalPaymentDecision(payment.verificationStatus) &&
          payment.verificationStatus === input.decision &&
          (payment.verifiedAmount?.toFixed(4) ?? null) === (verifiedAmount?.toFixed(4) ?? null) &&
          (payment.discrepancyReason ?? null) === input.discrepancyReason;
        if (identicalTerminal) {
          return refreshCommercialState(tx, {
            onboardingId: onboarding.id,
            correlationId: input.correlationId,
            triggeredByActorId: input.actorId,
            forceVersionIncrement: false,
          });
        }
        if (isTerminalPaymentDecision(payment.verificationStatus)) {
          reject(
            "PAYMENT_DECISION_CONFLICT",
            "This payment already has a different terminal decision.",
          );
        }
        if (payment.version !== input.expectedPaymentVersion) {
          reject("VERSION_CONFLICT", "The payment changed. Refresh and retry.");
        }
        if (input.decision === PaymentVerificationStatus.VERIFIED && !verifiedAmount) {
          reject("INVALID_INPUT", "Verified amount is required.");
        }
        if (
          input.decision === PaymentVerificationStatus.VERIFIED &&
          verifiedAmount &&
          !verifiedAmount.equals(payment.originalAmount) &&
          !input.discrepancyReason
        ) {
          reject("INVALID_INPUT", "Explain the difference from the recorded amount.");
        }
        if (
          (input.decision === PaymentVerificationStatus.REVIEW_REQUIRED ||
            input.decision === PaymentVerificationStatus.REJECTED) &&
          !input.discrepancyReason
        ) {
          reject("INVALID_INPUT", "A review or rejection reason is required.");
        }

        const terminal = isTerminalPaymentDecision(input.decision);
        const update = await tx.payment.updateMany({
          where: {
            id: payment.id,
            version: input.expectedPaymentVersion,
            verificationStatus: payment.verificationStatus,
          },
          data: {
            verificationStatus: input.decision,
            verifiedAmount:
              input.decision === PaymentVerificationStatus.VERIFIED ? verifiedAmount : null,
            discrepancyReason: input.discrepancyReason,
            verifiedById: terminal ? input.actorId : null,
            verifiedAt: terminal ? new Date() : null,
            version: { increment: 1 },
          },
        });
        if (update.count !== 1)
          reject("VERSION_CONFLICT", "The payment changed. Refresh and retry.");

        const verified = await tx.payment.aggregate({
          where: {
            invoiceId: onboarding.activationInvoice.id,
            verificationStatus: PaymentVerificationStatus.VERIFIED,
          },
          _sum: { verifiedAmount: true },
        });
        const verifiedTotal = verified._sum.verifiedAmount ?? new Prisma.Decimal(0);
        const invoiceStatus = verifiedTotal.gte(onboarding.activationInvoice.totalAmount)
          ? InvoiceStatus.PAID
          : verifiedTotal.gt(0)
            ? InvoiceStatus.PARTIALLY_PAID
            : InvoiceStatus.ISSUED;
        await tx.invoice.update({
          where: { id: onboarding.activationInvoice.id },
          data: { status: invoiceStatus },
        });

        const action = {
          [PaymentVerificationStatus.VERIFIED]: "PAYMENT_VERIFIED",
          [PaymentVerificationStatus.REVIEW_REQUIRED]: "PAYMENT_REVIEW_REQUIRED",
          [PaymentVerificationStatus.REJECTED]: "PAYMENT_REJECTED",
          [PaymentVerificationStatus.PENDING]: "PAYMENT_RECORDED",
        }[input.decision];
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action,
          entityType: "PAYMENT",
          entityId: payment.id,
          previousValue: {
            verificationStatus: payment.verificationStatus,
            paymentVersion: payment.version,
          },
          newValue: {
            verificationStatus: input.decision,
            verifiedAmount: verifiedAmount?.toFixed(4) ?? null,
            paymentVersion: payment.version + 1,
          },
          metadata: { discrepancyReasonProvided: Boolean(input.discrepancyReason) },
          correlationId: input.correlationId,
        });

        return refreshCommercialState(tx, {
          onboardingId: onboarding.id,
          expectedVersion: input.expectedVersion,
          correlationId: input.correlationId,
          triggeredByActorId: input.actorId,
          forceVersionIncrement: true,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

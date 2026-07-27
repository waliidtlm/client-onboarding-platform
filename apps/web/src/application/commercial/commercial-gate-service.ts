import {
  AuditActorType,
  CommercialGateStatus,
  InvoiceStatus,
  OnboardingStatus,
  PaymentVerificationStatus,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import { recalculateGateSchema } from "@/application/commercial/schemas";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
  type DatabaseClient,
  type TransactionClient,
} from "@/application/commercial/service-support";
import type { CommercialMutationResult } from "@/application/commercial/types";
import { calculateActivationRequirement } from "@/domain/commercial/activation-requirement";
import { calculateCommercialGate } from "@/domain/commercial/commercial-gate";
import type { Result } from "@/domain/errors";

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function refreshCommercialState(
  tx: TransactionClient,
  input: Readonly<{
    onboardingId: string;
    expectedVersion?: number;
    correlationId: string;
    triggeredByActorId: string;
    forceVersionIncrement: boolean;
    now?: Date;
  }>,
): Promise<CommercialMutationResult> {
  const now = input.now ?? new Date();
  const onboarding = await tx.onboarding.findUnique({
    where: { id: input.onboardingId },
    include: {
      contracts: { orderBy: { versionNumber: "desc" }, take: 1 },
      activationInvoice: { include: { payments: true } },
      commercialExceptions: {
        where: { status: "OPEN" },
        select: { id: true },
      },
    },
  });

  if (!onboarding) reject("NOT_FOUND", "The onboarding does not exist.");

  const invoice = onboarding.activationInvoice;
  const invoiceReady = Boolean(
    invoice &&
    invoice.status !== InvoiceStatus.DRAFT &&
    invoice.status !== InvoiceStatus.CANCELLED &&
    invoice.invoiceNumber &&
    invoice.dueAt,
  );
  const verifiedAmounts =
    invoice?.payments
      .filter(
        (payment) =>
          payment.verificationStatus === PaymentVerificationStatus.VERIFIED &&
          payment.verifiedAmount,
      )
      .map((payment) => payment.verifiedAmount as Prisma.Decimal) ?? [];

  const activation =
    onboarding.activationTypeSnapshot &&
    onboarding.activationValueSnapshot &&
    onboarding.invoiceTotal
      ? calculateActivationRequirement({
          activationType: onboarding.activationTypeSnapshot,
          activationValue: onboarding.activationValueSnapshot,
          agreedTotal: onboarding.invoiceTotal,
          invoiceReady,
          verifiedAmounts,
          manualApprovalActive: Boolean(
            onboarding.manualActivationApprovedAt && !onboarding.manualActivationRevokedAt,
          ),
        })
      : {
          requiredAmount: null,
          verifiedTotal: new Prisma.Decimal(0),
          status: onboarding.activationRequirementStatus,
          configurationError: null,
        };

  const gate = calculateCommercialGate({
    dealStatus: onboarding.dealStatus,
    contractStatus: onboarding.contracts[0]?.status ?? null,
    activationRequirementStatus: activation.status,
    hasBlockingPaymentReview: Boolean(
      invoice?.payments.some(
        (payment) => payment.verificationStatus === PaymentVerificationStatus.REVIEW_REQUIRED,
      ),
    ),
    hasPendingCommercialException: onboarding.commercialExceptions.length > 0,
    isCancelled: onboarding.status === OnboardingStatus.CANCELLED,
    evaluatedAt: now,
  });

  const activationChanged =
    onboarding.activationRequirementStatus !== activation.status ||
    (onboarding.activationRequiredAmount?.toFixed(4) ?? null) !==
      (activation.requiredAmount?.toFixed(4) ?? null);
  const gateChanged =
    onboarding.commercialGateStatus !== gate.status ||
    !sameStrings(onboarding.commercialGateBlockingReasons, gate.blockingReasons);
  const shouldActivate =
    gate.status === CommercialGateStatus.APPROVED &&
    onboarding.status === OnboardingStatus.COMMERCIAL_PENDING &&
    onboarding.activatedAt === null;
  const businessChanged =
    input.forceVersionIncrement || activationChanged || gateChanged || shouldActivate;

  const alreadyActivated =
    onboarding.status === OnboardingStatus.READY_FOR_ONBOARDING &&
    onboarding.activatedAt !== null &&
    gate.status === CommercialGateStatus.APPROVED;

  if (
    input.expectedVersion !== undefined &&
    onboarding.version !== input.expectedVersion &&
    !alreadyActivated
  ) {
    reject(
      "VERSION_CONFLICT",
      "The onboarding changed after this page loaded. Refresh and try again.",
    );
  }

  const nextVersion = businessChanged ? onboarding.version + 1 : onboarding.version;
  const update = await tx.onboarding.updateMany({
    where: {
      id: onboarding.id,
      ...(businessChanged ? { version: onboarding.version } : {}),
    },
    data: {
      activationRequiredAmount: activation.requiredAmount,
      activationRequirementStatus: activation.status,
      commercialGateStatus: gate.status,
      commercialGateBlockingReasons: [...gate.blockingReasons],
      commercialGateEvaluatedAt: now,
      ...(shouldActivate
        ? {
            status: OnboardingStatus.READY_FOR_ONBOARDING,
            activatedAt: now,
          }
        : {}),
      ...(businessChanged ? { version: { increment: 1 } } : {}),
    },
  });

  if (update.count !== 1) {
    reject("VERSION_CONFLICT", "Another commercial update completed first. Refresh and try again.");
  }

  if (activationChanged) {
    await appendAuditEvent(tx, {
      onboardingId: onboarding.id,
      actorType: AuditActorType.SYSTEM,
      action: "ACTIVATION_REQUIREMENT_RECALCULATED",
      entityType: "ONBOARDING",
      entityId: onboarding.id,
      previousValue: {
        status: onboarding.activationRequirementStatus,
        requiredAmount: onboarding.activationRequiredAmount?.toFixed(4) ?? null,
      },
      newValue: {
        status: activation.status,
        requiredAmount: activation.requiredAmount?.toFixed(4) ?? null,
        verifiedTotal: activation.verifiedTotal.toFixed(4),
      },
      metadata: {
        triggeredByActorId: input.triggeredByActorId,
        configurationError: activation.configurationError,
      },
      correlationId: input.correlationId,
    });
  }

  if (gateChanged) {
    await appendAuditEvent(tx, {
      onboardingId: onboarding.id,
      actorType: AuditActorType.SYSTEM,
      action: "COMMERCIAL_GATE_CHANGED",
      entityType: "ONBOARDING",
      entityId: onboarding.id,
      previousValue: {
        status: onboarding.commercialGateStatus,
        blockers: onboarding.commercialGateBlockingReasons,
      },
      newValue: {
        status: gate.status,
        blockers: gate.blockingReasons,
      },
      metadata: { triggeredByActorId: input.triggeredByActorId },
      correlationId: input.correlationId,
    });
  }

  if (shouldActivate) {
    await appendAuditEvent(tx, {
      onboardingId: onboarding.id,
      actorType: AuditActorType.SYSTEM,
      action: "ONBOARDING_ACTIVATED",
      entityType: "ONBOARDING",
      entityId: onboarding.id,
      previousValue: {
        status: onboarding.status,
        activatedAt: null,
      },
      newValue: {
        status: OnboardingStatus.READY_FOR_ONBOARDING,
        activatedAt: now.toISOString(),
      },
      metadata: { triggeredByActorId: input.triggeredByActorId },
      correlationId: input.correlationId,
    });
  }

  return {
    onboardingId: onboarding.id,
    version: nextVersion,
    status: shouldActivate ? OnboardingStatus.READY_FOR_ONBOARDING : onboarding.status,
    commercialGateStatus: gate.status,
    blockingReasons: gate.blockingReasons,
    activatedAt: shouldActivate
      ? now.toISOString()
      : (onboarding.activatedAt?.toISOString() ?? null),
    idempotent: !businessChanged,
  };
}

export async function recalculateCommercialGate(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(recalculateGateSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN]);
        return refreshCommercialState(tx, {
          onboardingId: input.onboardingId,
          ...(input.expectedVersion !== undefined
            ? { expectedVersion: input.expectedVersion }
            : {}),
          correlationId: input.correlationId,
          triggeredByActorId: input.actorId,
          forceVersionIncrement: false,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function activateOnboarding(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return recalculateCommercialGate(rawInput, database);
}

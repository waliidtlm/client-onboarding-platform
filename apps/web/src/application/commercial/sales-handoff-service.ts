import {
  ActivationRequirementStatus,
  AuditActorType,
  CommercialGateBlocker,
  CommercialGateStatus,
  ContractStatus,
  InvoiceStatus,
  OnboardingStatus,
  Prisma,
  Role,
  SalesHandoffStatus,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";
import { appendAuditEvent } from "@/application/commercial/audit";
import {
  correctHandoffSchema,
  createHandoffSchema,
  updateDealStatusSchema,
} from "@/application/commercial/schemas";
import {
  executeService,
  parseInput,
  reject,
  requireActor,
  type DatabaseClient,
  type TransactionClient,
} from "@/application/commercial/service-support";
import { refreshCommercialState } from "@/application/commercial/commercial-gate-service";
import type { CommercialMutationResult } from "@/application/commercial/types";
import { calculateActivationRequirement } from "@/domain/commercial/activation-requirement";
import { calculateCommercialGate } from "@/domain/commercial/commercial-gate";
import { validateHandoffCompleteness } from "@/domain/commercial/handoff-completeness";
import type { Result } from "@/domain/errors";

type ParsedHandoff = ReturnType<typeof createHandoffSchema.parse>;

async function validateAndMaterializeHandoff(
  tx: TransactionClient,
  input: Readonly<{
    onboardingId: string;
    expectedVersion: number;
    actorId: string;
    correlationId: string;
    handoff: ParsedHandoff;
  }>,
): Promise<CommercialMutationResult> {
  const agreedTotal = input.handoff.agreedTotal
    ? new Prisma.Decimal(input.handoff.agreedTotal)
    : null;
  const fieldErrors: Record<string, readonly string[]> = {
    ...validateHandoffCompleteness({
      ...input.handoff,
      agreedTotal,
    }),
  };

  const existingClient =
    input.handoff.clientMode === "EXISTING" && input.handoff.existingClientId
      ? await tx.client.findUnique({
          where: { id: input.handoff.existingClientId },
          select: { id: true },
        })
      : null;
  if (
    input.handoff.clientMode === "EXISTING" &&
    input.handoff.existingClientId &&
    !existingClient
  ) {
    fieldErrors.existingClientId = ["The selected client no longer exists."];
  }

  const servicePackage = input.handoff.servicePackageId
    ? await tx.servicePackage.findUnique({
        where: { id: input.handoff.servicePackageId },
        select: {
          id: true,
          name: true,
          isActive: true,
          activationType: true,
          activationValue: true,
        },
      })
    : null;
  if (input.handoff.servicePackageId && !servicePackage?.isActive) {
    fieldErrors.servicePackageId = ["Select an active service package."];
  }

  if (Object.keys(fieldErrors).length > 0) {
    const update = await tx.onboarding.updateMany({
      where: { id: input.onboardingId, version: input.expectedVersion },
      data: {
        salesHandoffStatus: SalesHandoffStatus.INCOMPLETE,
        status: OnboardingStatus.SALES_HANDOFF_INCOMPLETE,
        version: { increment: 1 },
      },
    });
    if (update.count !== 1) reject("VERSION_CONFLICT", "The handoff changed. Refresh and retry.");

    await tx.salesHandoff.update({
      where: { onboardingId: input.onboardingId },
      data: { validationErrors: fieldErrors },
    });
    await appendAuditEvent(tx, {
      onboardingId: input.onboardingId,
      actorType: AuditActorType.SYSTEM,
      action: "SALES_HANDOFF_VALIDATION_FAILED",
      entityType: "SALES_HANDOFF",
      entityId: input.onboardingId,
      newValue: { invalidFields: Object.keys(fieldErrors).sort() },
      metadata: { triggeredByActorId: input.actorId },
      correlationId: input.correlationId,
    });

    return {
      onboardingId: input.onboardingId,
      version: input.expectedVersion + 1,
      status: OnboardingStatus.SALES_HANDOFF_INCOMPLETE,
      commercialGateStatus: CommercialGateStatus.BLOCKED,
      blockingReasons: [
        CommercialGateBlocker.DEAL_NOT_CLOSED_WON,
        CommercialGateBlocker.CONTRACT_NOT_SIGNED,
        CommercialGateBlocker.ACTIVATION_AMOUNT_NOT_SATISFIED,
      ],
      activatedAt: null,
      idempotent: false,
    };
  }

  if (
    !servicePackage ||
    !agreedTotal ||
    !input.handoff.currency ||
    !input.handoff.externalDealId ||
    !input.handoff.dealStatus
  ) {
    reject("INVALID_INPUT", "The handoff is incomplete.");
  }

  let clientId = existingClient?.id ?? null;
  if (input.handoff.clientMode === "NEW") {
    const client = await tx.client.create({
      data: {
        companyName: input.handoff.newClientCompanyName as string,
        contactName: input.handoff.newClientContactName as string,
        contactEmail: (input.handoff.newClientContactEmail as string).toLowerCase(),
        contactPhone: input.handoff.newClientContactPhone,
      },
      select: { id: true },
    });
    clientId = client.id;
  }
  if (!clientId) reject("INVALID_INPUT", "A client is required.");

  const activation = calculateActivationRequirement({
    activationType: servicePackage.activationType,
    activationValue: servicePackage.activationValue,
    agreedTotal,
    invoiceReady: false,
    verifiedAmounts: [],
    manualApprovalActive: false,
  });
  if (activation.configurationError) {
    reject("CONFIGURATION_ERROR", activation.configurationError);
  }

  await tx.contract.create({
    data: {
      onboardingId: input.onboardingId,
      status: ContractStatus.DRAFT,
      versionNumber: 1,
    },
  });
  const invoice = await tx.invoice.create({
    data: {
      onboardingId: input.onboardingId,
      status: InvoiceStatus.DRAFT,
      totalAmount: agreedTotal,
      currency: input.handoff.currency,
    },
    select: { id: true },
  });

  const gate = calculateCommercialGate({
    dealStatus: input.handoff.dealStatus,
    contractStatus: ContractStatus.DRAFT,
    activationRequirementStatus: activation.status,
    hasBlockingPaymentReview: false,
    hasPendingCommercialException: false,
    isCancelled: false,
    evaluatedAt: new Date(),
  });
  const update = await tx.onboarding.updateMany({
    where: { id: input.onboardingId, version: input.expectedVersion },
    data: {
      clientId,
      servicePackageId: servicePackage.id,
      externalDealId: input.handoff.externalDealId,
      dealStatus: input.handoff.dealStatus,
      salesHandoffStatus: SalesHandoffStatus.COMPLETE,
      status: OnboardingStatus.COMMERCIAL_PENDING,
      validatedById: input.actorId,
      invoiceTotal: agreedTotal,
      currency: input.handoff.currency,
      servicePackageNameSnapshot: servicePackage.name,
      activationTypeSnapshot: servicePackage.activationType,
      activationValueSnapshot: servicePackage.activationValue,
      activationRequiredAmount: activation.requiredAmount,
      activationRequirementStatus: activation.status,
      activationInvoiceId: invoice.id,
      commercialGateStatus: gate.status,
      commercialGateBlockingReasons: [...gate.blockingReasons],
      commercialGateEvaluatedAt: new Date(gate.evaluatedAt),
      version: { increment: 1 },
    },
  });
  if (update.count !== 1) reject("VERSION_CONFLICT", "The handoff changed. Refresh and retry.");

  await tx.salesHandoff.update({
    where: { onboardingId: input.onboardingId },
    data: { validationErrors: Prisma.JsonNull },
  });
  await appendAuditEvent(tx, {
    onboardingId: input.onboardingId,
    actorType: AuditActorType.STAFF,
    actorId: input.actorId,
    action: "SALES_HANDOFF_VALIDATED",
    entityType: "SALES_HANDOFF",
    entityId: input.onboardingId,
    newValue: {
      clientId,
      clientMode: input.handoff.clientMode,
      servicePackageId: servicePackage.id,
      packageName: servicePackage.name,
      externalDealId: input.handoff.externalDealId,
      dealStatus: input.handoff.dealStatus,
      agreedTotal: agreedTotal.toFixed(4),
      currency: input.handoff.currency,
      activationType: servicePackage.activationType,
      activationValue: servicePackage.activationValue.toFixed(4),
      activationRequiredAmount: activation.requiredAmount?.toFixed(4) ?? null,
    },
    correlationId: input.correlationId,
  });

  return {
    onboardingId: input.onboardingId,
    version: input.expectedVersion + 1,
    status: OnboardingStatus.COMMERCIAL_PENDING,
    commercialGateStatus: gate.status,
    blockingReasons: gate.blockingReasons,
    activatedAt: null,
    idempotent: false,
  };
}

export async function createOnboardingFromSalesHandoff(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(createHandoffSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.SALES]);

        const repeated = await tx.salesHandoff.findUnique({
          where: { submissionKey: input.submissionKey },
          include: { onboarding: true },
        });
        if (repeated) {
          return {
            onboardingId: repeated.onboardingId,
            version: repeated.onboarding.version,
            status: repeated.onboarding.status,
            commercialGateStatus: repeated.onboarding.commercialGateStatus,
            blockingReasons: repeated.onboarding.commercialGateBlockingReasons,
            activatedAt: repeated.onboarding.activatedAt?.toISOString() ?? null,
            idempotent: true,
          };
        }

        const onboarding = await tx.onboarding.create({
          data: {
            salesHandoffStatus: SalesHandoffStatus.PENDING_VALIDATION,
            commercialGateStatus: CommercialGateStatus.BLOCKED,
            commercialGateBlockingReasons: [
              CommercialGateBlocker.DEAL_NOT_CLOSED_WON,
              CommercialGateBlocker.CONTRACT_NOT_SIGNED,
              CommercialGateBlocker.ACTIVATION_AMOUNT_NOT_SATISFIED,
            ],
            status: OnboardingStatus.SALES_HANDOFF_INCOMPLETE,
            submittedById: input.actorId,
            activationRequirementStatus: ActivationRequirementStatus.NOT_SATISFIED,
          },
          select: { id: true, version: true },
        });
        await tx.salesHandoff.create({
          data: {
            onboardingId: onboarding.id,
            submissionKey: input.submissionKey,
            externalDealId: input.externalDealId,
            clientMode: input.clientMode,
            existingClientId: input.existingClientId,
            newClientCompanyName: input.newClientCompanyName,
            newClientContactName: input.newClientContactName,
            newClientContactEmail: input.newClientContactEmail?.toLowerCase() ?? null,
            newClientContactPhone: input.newClientContactPhone,
            servicePackageId: input.servicePackageId,
            dealStatus: input.dealStatus,
            agreedTotal: input.agreedTotal ? new Prisma.Decimal(input.agreedTotal) : null,
            currency: input.currency,
            salesNotes: input.salesNotes,
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: onboarding.id,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "SALES_HANDOFF_SUBMITTED",
          entityType: "SALES_HANDOFF",
          entityId: onboarding.id,
          newValue: {
            externalDealId: input.externalDealId,
            clientMode: input.clientMode,
            servicePackageId: input.servicePackageId,
            dealStatus: input.dealStatus,
            agreedTotal: input.agreedTotal,
            currency: input.currency,
          },
          correlationId: input.correlationId,
        });

        return validateAndMaterializeHandoff(tx, {
          onboardingId: onboarding.id,
          expectedVersion: onboarding.version,
          actorId: input.actorId,
          correlationId: input.correlationId,
          handoff: input,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  });
}

export async function correctSalesHandoff(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(correctHandoffSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.SALES]);
        const current = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
          include: { salesHandoff: true },
        });
        if (!current?.salesHandoff) reject("NOT_FOUND", "The sales handoff does not exist.");
        if (current.status !== OnboardingStatus.SALES_HANDOFF_INCOMPLETE) {
          reject("INVALID_TRANSITION", "Only an incomplete sales handoff can be corrected.");
        }
        if (current.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The handoff changed. Refresh and retry.");
        }

        await tx.salesHandoff.update({
          where: { onboardingId: input.onboardingId },
          data: {
            externalDealId: input.externalDealId,
            clientMode: input.clientMode,
            existingClientId: input.existingClientId,
            newClientCompanyName: input.newClientCompanyName,
            newClientContactName: input.newClientContactName,
            newClientContactEmail: input.newClientContactEmail?.toLowerCase() ?? null,
            newClientContactPhone: input.newClientContactPhone,
            servicePackageId: input.servicePackageId,
            dealStatus: input.dealStatus,
            agreedTotal: input.agreedTotal ? new Prisma.Decimal(input.agreedTotal) : null,
            currency: input.currency,
            salesNotes: input.salesNotes,
            version: { increment: 1 },
          },
        });
        await appendAuditEvent(tx, {
          onboardingId: input.onboardingId,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "SALES_HANDOFF_CORRECTED",
          entityType: "SALES_HANDOFF",
          entityId: current.salesHandoff.id,
          previousValue: { handoffVersion: current.salesHandoff.version },
          newValue: { handoffVersion: current.salesHandoff.version + 1 },
          correlationId: input.correlationId,
        });

        return validateAndMaterializeHandoff(tx, {
          onboardingId: input.onboardingId,
          expectedVersion: input.expectedVersion,
          actorId: input.actorId,
          correlationId: input.correlationId,
          handoff: {
            actorId: input.actorId,
            correlationId: input.correlationId,
            submissionKey: current.salesHandoff.submissionKey,
            externalDealId: input.externalDealId,
            clientMode: input.clientMode,
            existingClientId: input.existingClientId,
            newClientCompanyName: input.newClientCompanyName,
            newClientContactName: input.newClientContactName,
            newClientContactEmail: input.newClientContactEmail,
            newClientContactPhone: input.newClientContactPhone,
            servicePackageId: input.servicePackageId,
            dealStatus: input.dealStatus,
            agreedTotal: input.agreedTotal,
            currency: input.currency,
            salesNotes: input.salesNotes,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

export async function updateDealStatus(
  rawInput: unknown,
  database: DatabaseClient = prisma,
): Promise<Result<CommercialMutationResult>> {
  return executeService(async () => {
    const input = parseInput(updateDealStatusSchema.safeParse(rawInput));
    return database.$transaction(
      async (tx) => {
        await requireActor(tx, input.actorId, [Role.ADMIN, Role.SALES]);
        const current = await tx.onboarding.findUnique({
          where: { id: input.onboardingId },
          select: { status: true, dealStatus: true, version: true },
        });
        if (!current) reject("NOT_FOUND", "The onboarding does not exist.");
        if (current.status !== OnboardingStatus.COMMERCIAL_PENDING) {
          reject("INVALID_TRANSITION", "Deal status can change only before activation.");
        }
        if (current.version !== input.expectedVersion) {
          reject("VERSION_CONFLICT", "The onboarding changed. Refresh and retry.");
        }
        if (current.dealStatus === input.dealStatus) {
          return refreshCommercialState(tx, {
            onboardingId: input.onboardingId,
            correlationId: input.correlationId,
            triggeredByActorId: input.actorId,
            forceVersionIncrement: false,
          });
        }

        await tx.onboarding.update({
          where: { id: input.onboardingId },
          data: { dealStatus: input.dealStatus },
        });
        await tx.salesHandoff.update({
          where: { onboardingId: input.onboardingId },
          data: { dealStatus: input.dealStatus },
        });
        await appendAuditEvent(tx, {
          onboardingId: input.onboardingId,
          actorType: AuditActorType.STAFF,
          actorId: input.actorId,
          action: "DEAL_STATUS_UPDATED",
          entityType: "ONBOARDING",
          entityId: input.onboardingId,
          previousValue: { dealStatus: current.dealStatus },
          newValue: { dealStatus: input.dealStatus },
          correlationId: input.correlationId,
        });
        return refreshCommercialState(tx, {
          onboardingId: input.onboardingId,
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

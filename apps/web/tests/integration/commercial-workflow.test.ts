import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ActivationType,
  ContractStatus,
  DealStatus,
  OnboardingStatus,
  PaymentVerificationStatus,
  PrismaClient,
  Role,
} from "../../src/generated/prisma/client";
import {
  createOnboardingFromSalesHandoff,
  correctSalesHandoff,
} from "../../src/application/commercial/sales-handoff-service";
import { issueActivationInvoice } from "../../src/application/commercial/invoice-service";
import { recordPayment, reviewPayment } from "../../src/application/commercial/payment-service";
import { updateContractStatus } from "../../src/application/commercial/contract-service";
import {
  approveManualActivationRequirement,
  revokeManualActivationRequirement,
} from "../../src/application/commercial/manual-approval-service";
import { recalculateCommercialGate } from "../../src/application/commercial/commercial-gate-service";
import { getOnboardingDetail, listOnboardings } from "../../src/lib/onboardings/queries";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");

const client = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
});

let salesId = "";
let financeId = "";
let operationsId = "";
let adminId = "";
let packageId = "";
let atlasClientId = "";

const handoffInput = (overrides: Record<string, unknown> = {}) => ({
  actorId: salesId,
  correlationId: randomUUID(),
  submissionKey: randomUUID(),
  externalDealId: `DEAL-TEST-${randomUUID()}`,
  clientMode: "EXISTING",
  existingClientId: atlasClientId,
  newClientCompanyName: null,
  newClientContactName: null,
  newClientContactEmail: null,
  newClientContactPhone: null,
  servicePackageId: packageId,
  dealStatus: DealStatus.CLOSED_WON,
  agreedTotal: "10000.0000",
  currency: "USD",
  salesNotes: "Integration test handoff",
  ...overrides,
});

beforeAll(async () => {
  const [sales, finance, operations, admin, servicePackage, atlas] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    client.user.findUniqueOrThrow({ where: { email: "finance@northstar.test" } }),
    client.user.findUniqueOrThrow({ where: { email: "operations@northstar.test" } }),
    client.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
    client.servicePackage.findUniqueOrThrow({ where: { name: "Paid Growth Launch" } }),
    client.client.findUniqueOrThrow({ where: { companyName: "Atlas Fitness Studio" } }),
  ]);
  salesId = sales.id;
  financeId = finance.id;
  operationsId = operations.id;
  adminId = admin.id;
  packageId = servicePackage.id;
  atlasClientId = atlas.id;
});

afterAll(async () => client.$disconnect());

describe("Phase 2 commercial workflow", () => {
  it("creates an incomplete onboarding early, retries idempotently, then creates one new client", async () => {
    const submissionKey = randomUUID();
    const first = await createOnboardingFromSalesHandoff(
      handoffInput({
        submissionKey,
        externalDealId: null,
        clientMode: "NEW",
        existingClientId: null,
        newClientCompanyName: "Northwind Wellness Test",
        newClientContactName: null,
        newClientContactEmail: null,
      }),
      client,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.status).toBe(OnboardingStatus.SALES_HANDOFF_INCOMPLETE);
    expect((await listOnboardings()).some((record) => record.id === first.value.onboardingId)).toBe(
      true,
    );
    const incompleteDetail = await getOnboardingDetail(first.value.onboardingId, {
      id: salesId,
      name: "Sales Test",
      email: "sales@northstar.test",
      role: Role.SALES,
    });
    expect(incompleteDetail?.client).toBe("Northwind Wellness Test");
    expect(incompleteDetail?.servicePackage).toBe("Package not selected");

    const repeated = await createOnboardingFromSalesHandoff(
      handoffInput({ submissionKey, externalDealId: null }),
      client,
    );
    expect(repeated.ok && repeated.value.idempotent).toBe(true);
    if (!repeated.ok) return;
    expect(repeated.value.onboardingId).toBe(first.value.onboardingId);

    const completedExternalDealId = `DEAL-NEW-CLIENT-${randomUUID()}`;
    const corrected = await correctSalesHandoff(
      {
        ...handoffInput({
          externalDealId: completedExternalDealId,
          clientMode: "NEW",
          existingClientId: null,
          newClientCompanyName: "Northwind Wellness Test",
          newClientContactName: "Nora North",
          newClientContactEmail: "nora@northwind-wellness.test",
        }),
        onboardingId: first.value.onboardingId,
        expectedVersion: first.value.version,
      },
      client,
    );
    expect(corrected.ok && corrected.value.status).toBe(OnboardingStatus.COMMERCIAL_PENDING);

    const repeatedAfterValidation = await createOnboardingFromSalesHandoff(
      handoffInput({
        submissionKey,
        externalDealId: completedExternalDealId,
        clientMode: "NEW",
        existingClientId: null,
        newClientCompanyName: "Northwind Wellness Test",
        newClientContactName: "Nora North",
        newClientContactEmail: "nora@northwind-wellness.test",
      }),
      client,
    );
    expect(repeatedAfterValidation.ok && repeatedAfterValidation.value.idempotent).toBe(true);
    if (!repeatedAfterValidation.ok) return;
    expect(repeatedAfterValidation.value.onboardingId).toBe(first.value.onboardingId);

    const stored = await client.onboarding.findUniqueOrThrow({
      where: { id: first.value.onboardingId },
      include: { client: true, activationInvoice: true, contracts: true },
    });
    expect(stored.client?.companyName).toBe("Northwind Wellness Test");
    expect(stored.activationInvoice?.status).toBe("DRAFT");
    expect(stored.activationInvoice?.invoiceNumber).toBeNull();
    expect(stored.contracts).toHaveLength(1);
    expect(stored.contracts[0]?.status).toBe(ContractStatus.DRAFT);
    expect(await client.client.count({ where: { companyName: "Northwind Wellness Test" } })).toBe(
      1,
    );
  });

  it("selects an existing client and keeps the package snapshot stable", async () => {
    const result = await createOnboardingFromSalesHandoff(handoffInput(), client);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = await client.onboarding.findUniqueOrThrow({
      where: { id: result.value.onboardingId },
    });
    await client.servicePackage.update({
      where: { id: packageId },
      data: { activationValue: "40.0000" },
    });
    const after = await client.onboarding.findUniqueOrThrow({
      where: { id: result.value.onboardingId },
    });
    await client.servicePackage.update({
      where: { id: packageId },
      data: { activationValue: "30.0000" },
    });

    expect(after.clientId).toBe(atlasClientId);
    expect(before.activationValueSnapshot?.toFixed(4)).toBe("30.0000");
    expect(after.activationValueSnapshot?.toFixed(4)).toBe("30.0000");
    expect(after.activationRequiredAmount?.toFixed(4)).toBe("3000.0000");
  });

  it("rejects simultaneous duplicate external deals at the database boundary", async () => {
    const externalDealId = `DEAL-CONCURRENT-${randomUUID()}`;
    const [left, right] = await Promise.all([
      createOnboardingFromSalesHandoff(
        handoffInput({ submissionKey: randomUUID(), externalDealId }),
        client,
      ),
      createOnboardingFromSalesHandoff(
        handoffInput({ submissionKey: randomUUID(), externalDealId }),
        client,
      ),
    ]);

    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    const rejected = [left, right].find((result) => !result.ok);
    expect(rejected && !rejected.ok ? rejected.error.code : null).toBe("DUPLICATE_EXTERNAL_DEAL");
    expect(await client.salesHandoff.count({ where: { externalDealId } })).toBe(1);
    expect(await client.onboarding.count({ where: { externalDealId } })).toBe(1);
  });

  it("keeps invoice issuance with Finance and rejects draft-invoice payments", async () => {
    const handoff = await createOnboardingFromSalesHandoff(handoffInput(), client);
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;

    const salesIssue = await issueActivationInvoice(
      {
        actorId: salesId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: handoff.value.version,
        invoiceNumber: `INV-${randomUUID()}`,
        dueAt: "2026-09-01T23:59:59.000Z",
      },
      client,
    );
    expect(salesIssue.ok).toBe(false);
    if (!salesIssue.ok) expect(salesIssue.error.code).toBe("ACCESS_DENIED");

    const draftPayment = await recordPayment(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: handoff.value.version,
        recordingKey: randomUUID(),
        originalAmount: "1000.0000",
        currency: "USD",
        externalReference: null,
      },
      client,
    );
    expect(draftPayment.ok).toBe(false);
    if (!draftPayment.ok) expect(draftPayment.error.code).toBe("INVALID_TRANSITION");

    const issued = await issueActivationInvoice(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: handoff.value.version,
        invoiceNumber: `INV-${randomUUID()}`,
        dueAt: "2026-09-01T23:59:59.000Z",
      },
      client,
    );
    expect(issued.ok).toBe(true);
    expect(
      await client.auditEvent.count({
        where: {
          onboardingId: handoff.value.onboardingId,
          action: "ACTIVATION_INVOICE_ISSUED",
        },
      }),
    ).toBe(1);
  });

  it("preserves a signed contract when a revision creates a new version", async () => {
    const handoff = await createOnboardingFromSalesHandoff(handoffInput(), client);
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;

    const financeContract = await updateContractStatus(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: handoff.value.version,
        targetStatus: ContractStatus.PENDING_SIGNATURE,
        revisionReason: null,
        signatureDeadline: null,
        externalReference: null,
      },
      client,
    );
    expect(financeContract.ok).toBe(false);
    if (!financeContract.ok) expect(financeContract.error.code).toBe("ACCESS_DENIED");

    const financeHandoff = await createOnboardingFromSalesHandoff(
      handoffInput({ actorId: financeId }),
      client,
    );
    expect(financeHandoff.ok).toBe(false);
    if (!financeHandoff.ok) expect(financeHandoff.error.code).toBe("ACCESS_DENIED");

    const pending = await updateContractStatus(
      {
        actorId: operationsId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: handoff.value.version,
        targetStatus: ContractStatus.PENDING_SIGNATURE,
        revisionReason: null,
        signatureDeadline: null,
        externalReference: null,
      },
      client,
    );
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const signed = await updateContractStatus(
      {
        actorId: operationsId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: pending.value.version,
        targetStatus: ContractStatus.SIGNED,
        revisionReason: null,
        signatureDeadline: null,
        externalReference: "SIGNED-V1",
      },
      client,
    );
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const revision = await updateContractStatus(
      {
        actorId: operationsId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: signed.value.version,
        targetStatus: ContractStatus.REVISION_REQUESTED,
        revisionReason: "Commercial scope changed",
        signatureDeadline: null,
        externalReference: null,
      },
      client,
    );
    expect(revision.ok).toBe(true);

    const contracts = await client.contract.findMany({
      where: { onboardingId: handoff.value.onboardingId },
      orderBy: { versionNumber: "asc" },
    });
    expect(contracts.map(({ versionNumber, status }) => [versionNumber, status])).toEqual([
      [1, ContractStatus.SIGNED],
      [2, ContractStatus.REVISION_REQUESTED],
    ]);
  });

  it("allows manual approval revocation before activation but not after activation", async () => {
    const manualPackage = await client.servicePackage.upsert({
      where: { name: "Manual Approval Test Package" },
      create: {
        name: "Manual Approval Test Package",
        description: "Integration-only manual package",
        activationType: ActivationType.MANUAL_APPROVAL,
        activationValue: "0.0000",
      },
      update: {},
    });
    const handoff = await createOnboardingFromSalesHandoff(
      handoffInput({ servicePackageId: manualPackage.id }),
      client,
    );
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;
    const issued = await issueActivationInvoice(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: handoff.value.version,
        invoiceNumber: `MANUAL-${randomUUID()}`,
        dueAt: "2026-09-01T23:59:59.000Z",
      },
      client,
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const approved = await approveManualActivationRequirement(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: issued.value.version,
      },
      client,
    );
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.status).toBe(OnboardingStatus.COMMERCIAL_PENDING);

    const revoked = await revokeManualActivationRequirement(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: approved.value.version,
        reason: "Approval selected in error",
      },
      client,
    );
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;

    const pending = await updateContractStatus(
      {
        actorId: operationsId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: revoked.value.version,
        targetStatus: ContractStatus.PENDING_SIGNATURE,
        revisionReason: null,
        signatureDeadline: null,
        externalReference: null,
      },
      client,
    );
    expect(pending.ok).toBe(true);
    if (!pending.ok) return;
    const signed = await updateContractStatus(
      {
        actorId: operationsId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: pending.value.version,
        targetStatus: ContractStatus.SIGNED,
        revisionReason: null,
        signatureDeadline: null,
        externalReference: null,
      },
      client,
    );
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const activated = await approveManualActivationRequirement(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: signed.value.version,
      },
      client,
    );
    expect(activated.ok && activated.value.status).toBe(OnboardingStatus.READY_FOR_ONBOARDING);
    if (!activated.ok) return;

    const revokeAfterActivation = await revokeManualActivationRequirement(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: activated.value.version,
        reason: "This must be rejected",
      },
      client,
    );
    expect(revokeAfterActivation.ok).toBe(false);
    if (!revokeAfterActivation.ok) {
      expect(revokeAfterActivation.error.code).toBe("INVALID_TRANSITION");
    }
  });

  it("applies the Atlas 30% rule and activates one existing onboarding exactly once", async () => {
    const handoff = await createOnboardingFromSalesHandoff(handoffInput(), client);
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;
    const issued = await issueActivationInvoice(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: handoff.value.version,
        invoiceNumber: `ATLAS-RULE-${randomUUID()}`,
        dueAt: "2026-09-01T23:59:59.000Z",
      },
      client,
    );
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const pendingContract = await updateContractStatus(
      {
        actorId: operationsId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: issued.value.version,
        targetStatus: ContractStatus.PENDING_SIGNATURE,
        revisionReason: null,
        signatureDeadline: null,
        externalReference: null,
      },
      client,
    );
    expect(pendingContract.ok).toBe(true);
    if (!pendingContract.ok) return;
    const signed = await updateContractStatus(
      {
        actorId: operationsId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: pendingContract.value.version,
        targetStatus: ContractStatus.SIGNED,
        revisionReason: null,
        signatureDeadline: null,
        externalReference: null,
      },
      client,
    );
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    const firstRecorded = await recordPayment(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: signed.value.version,
        recordingKey: randomUUID(),
        originalAmount: "2000.0000",
        currency: "USD",
        externalReference: null,
      },
      client,
    );
    expect(firstRecorded.ok).toBe(true);
    if (!firstRecorded.ok) return;
    const firstPayment = await client.payment.findFirstOrThrow({
      where: {
        invoice: { onboardingId: handoff.value.onboardingId },
        originalAmount: "2000.0000",
      },
      orderBy: { createdAt: "desc" },
    });
    const firstReview = await reviewPayment(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: firstRecorded.value.version,
        paymentId: firstPayment.id,
        expectedPaymentVersion: firstPayment.version,
        decision: PaymentVerificationStatus.VERIFIED,
        verifiedAmount: "2000.0000",
        discrepancyReason: null,
      },
      client,
    );
    expect(firstReview.ok).toBe(true);
    if (!firstReview.ok) return;
    expect(firstReview.value.status).toBe(OnboardingStatus.COMMERCIAL_PENDING);

    const additionalRecorded = await recordPayment(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: firstReview.value.version,
        recordingKey: randomUUID(),
        originalAmount: "1000.0000",
        currency: "USD",
        externalReference: null,
      },
      client,
    );
    expect(additionalRecorded.ok).toBe(true);
    if (!additionalRecorded.ok) return;
    const additionalPayment = await client.payment.findFirstOrThrow({
      where: {
        invoice: { onboardingId: handoff.value.onboardingId },
        originalAmount: "1000.0000",
      },
      orderBy: { createdAt: "desc" },
    });
    const reviewed = await reviewPayment(
      {
        actorId: financeId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: additionalRecorded.value.version,
        paymentId: additionalPayment.id,
        expectedPaymentVersion: additionalPayment.version,
        decision: PaymentVerificationStatus.VERIFIED,
        verifiedAmount: "1000.0000",
        discrepancyReason: null,
      },
      client,
    );
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    expect(reviewed.value.status).toBe(OnboardingStatus.READY_FOR_ONBOARDING);

    const stored = await client.onboarding.findUniqueOrThrow({
      where: { id: handoff.value.onboardingId },
    });
    const repeated = await recalculateCommercialGate(
      {
        actorId: adminId,
        correlationId: randomUUID(),
        onboardingId: handoff.value.onboardingId,
        expectedVersion: handoff.value.version,
      },
      client,
    );
    expect(repeated.ok && repeated.value.idempotent).toBe(true);
    const afterRepeated = await client.onboarding.findUniqueOrThrow({
      where: { id: handoff.value.onboardingId },
    });
    expect(afterRepeated.id).toBe(handoff.value.onboardingId);
    expect(afterRepeated.version).toBe(stored.version);
    expect(
      await client.auditEvent.count({
        where: {
          onboardingId: handoff.value.onboardingId,
          action: "ONBOARDING_ACTIVATED",
        },
      }),
    ).toBe(1);
  });
});

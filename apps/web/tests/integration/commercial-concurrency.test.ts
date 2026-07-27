import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ActivationRequirementStatus,
  ActivationType,
  AuditActorType,
  CommercialGateStatus,
  ContractStatus,
  DealStatus,
  InvoiceStatus,
  OnboardingStatus,
  PaymentVerificationStatus,
  PrismaClient,
} from "../../src/generated/prisma/client";
import { activateOnboarding } from "../../src/application/commercial/commercial-gate-service";
import { updateDealStatus } from "../../src/application/commercial/sales-handoff-service";

const runtimeUrl = process.env.TEST_DATABASE_URL;
const migrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
if (!runtimeUrl || !migrationUrl) throw new Error("Test database URLs are required");

const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }) });
const migration = new PrismaClient({ adapter: new PrismaPg({ connectionString: migrationUrl }) });
let salesId = "";
let financeId = "";
let adminId = "";

beforeAll(async () => {
  const [sales, finance, admin] = await Promise.all([
    runtime.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    runtime.user.findUniqueOrThrow({ where: { email: "finance@northstar.test" } }),
    runtime.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
  ]);
  salesId = sales.id;
  financeId = finance.id;
  adminId = admin.id;
});

afterAll(async () => Promise.all([runtime.$disconnect(), migration.$disconnect()]));

describe("Phase 2 transaction and audit integrity", () => {
  it("rejects AuditEvent update and deletion with runtime credentials", async () => {
    const event = await runtime.auditEvent.findFirstOrThrow();
    await expect(
      runtime.auditEvent.update({
        where: { id: event.id },
        data: { action: "MUTATION_ATTEMPT" },
      }),
    ).rejects.toThrow();
    await expect(runtime.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow();
  });

  it("rolls back an authoritative transition when audit insertion is denied", async () => {
    const atlas = await runtime.onboarding.findUniqueOrThrow({
      where: { externalDealId: "DEAL-ATLAS-2026-001" },
    });
    await migration.$executeRawUnsafe(
      'REVOKE INSERT ON TABLE "AuditEvent" FROM "onboarding_test_user"',
    );
    try {
      await expect(
        updateDealStatus(
          {
            actorId: salesId,
            correlationId: randomUUID(),
            onboardingId: atlas.id,
            expectedVersion: atlas.version,
            dealStatus: DealStatus.OPEN,
          },
          runtime,
        ),
      ).rejects.toThrow();
    } finally {
      await migration.$executeRawUnsafe(
        'GRANT INSERT ON TABLE "AuditEvent" TO "onboarding_test_user"',
      );
    }

    const after = await runtime.onboarding.findUniqueOrThrow({ where: { id: atlas.id } });
    expect(after.dealStatus).toBe(atlas.dealStatus);
    expect(after.version).toBe(atlas.version);
  });

  it("database uniqueness prevents duplicate activation audit events", async () => {
    const existing = await runtime.onboarding.findFirstOrThrow();
    const onboarding = await runtime.onboarding.create({
      data: {
        clientId: existing.clientId,
        servicePackageId: existing.servicePackageId,
        externalDealId: `AUDIT-UNIQUE-${randomUUID()}`,
        dealStatus: DealStatus.CLOSED_WON,
        salesHandoffStatus: "COMPLETE",
        commercialGateStatus: CommercialGateStatus.APPROVED,
        status: OnboardingStatus.READY_FOR_ONBOARDING,
        submittedById: salesId,
        invoiceTotal: "1.0000",
        currency: "USD",
        servicePackageNameSnapshot: "Audit fixture",
        activationTypeSnapshot: "FULL_PAYMENT_PERCENTAGE",
        activationValueSnapshot: "100.0000",
        activationRequiredAmount: "1.0000",
        activationRequirementStatus: ActivationRequirementStatus.SATISFIED,
        activatedAt: new Date(),
      },
    });
    const base = {
      onboardingId: onboarding.id,
      actorType: AuditActorType.SYSTEM,
      action: "ONBOARDING_ACTIVATED",
      entityType: "ONBOARDING",
      entityId: onboarding.id,
      correlationId: randomUUID(),
    } as const;
    await runtime.auditEvent.create({ data: base });
    await expect(
      runtime.auditEvent.create({
        data: { ...base, correlationId: randomUUID() },
      }),
    ).rejects.toThrow();
  });

  it("activates exactly once when two eligible requests race", async () => {
    const existing = await runtime.onboarding.findFirstOrThrow();
    const onboarding = await runtime.onboarding.create({
      data: {
        clientId: existing.clientId,
        servicePackageId: existing.servicePackageId,
        externalDealId: `ACTIVATION-RACE-${randomUUID()}`,
        dealStatus: DealStatus.CLOSED_WON,
        salesHandoffStatus: "COMPLETE",
        commercialGateStatus: CommercialGateStatus.BLOCKED,
        status: OnboardingStatus.COMMERCIAL_PENDING,
        submittedById: salesId,
        invoiceTotal: "1.0000",
        currency: "USD",
        servicePackageNameSnapshot: "Activation race fixture",
        activationTypeSnapshot: ActivationType.FULL_PAYMENT_PERCENTAGE,
        activationValueSnapshot: "100.0000",
        activationRequiredAmount: "1.0000",
        activationRequirementStatus: ActivationRequirementStatus.SATISFIED,
        contracts: {
          create: {
            status: ContractStatus.SIGNED,
            versionNumber: 1,
            signedAt: new Date(),
          },
        },
      },
    });
    const invoice = await runtime.invoice.create({
      data: {
        onboardingId: onboarding.id,
        status: InvoiceStatus.ISSUED,
        invoiceNumber: `RACE-${randomUUID()}`,
        totalAmount: "1.0000",
        currency: "USD",
        dueAt: new Date("2026-09-01T23:59:59.000Z"),
      },
    });
    await runtime.payment.create({
      data: {
        invoiceId: invoice.id,
        originalAmount: "1.0000",
        verifiedAmount: "1.0000",
        currency: "USD",
        verificationStatus: PaymentVerificationStatus.VERIFIED,
        submittedById: financeId,
        verifiedById: financeId,
        verifiedAt: new Date(),
        recordingKey: randomUUID(),
      },
    });
    await runtime.onboarding.update({
      where: { id: onboarding.id },
      data: { activationInvoiceId: invoice.id },
    });

    const input = {
      actorId: adminId,
      onboardingId: onboarding.id,
      expectedVersion: onboarding.version,
    };
    const [left, right] = await Promise.all([
      activateOnboarding({ ...input, correlationId: randomUUID() }, runtime),
      activateOnboarding({ ...input, correlationId: randomUUID() }, runtime),
    ]);

    expect([left, right].some((result) => result.ok)).toBe(true);
    const stored = await runtime.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } });
    expect(stored.status).toBe(OnboardingStatus.READY_FOR_ONBOARDING);
    expect(stored.activatedAt).not.toBeNull();
    expect(
      await runtime.auditEvent.count({
        where: { onboardingId: onboarding.id, action: "ONBOARDING_ACTIVATED" },
      }),
    ).toBe(1);
  });
});

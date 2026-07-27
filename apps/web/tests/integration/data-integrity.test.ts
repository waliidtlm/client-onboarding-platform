import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  CommercialGateStatus,
  OnboardingStatus,
  PaymentVerificationStatus,
  PrismaClient,
  Role,
} from "../../src/generated/prisma/client";
import { seedDatabase } from "../../prisma/seed";

const testRuntimeUrl = process.env.TEST_DATABASE_URL;
const testMigrationUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const testStaffPassword = process.env.TEST_STAFF_PASSWORD;

if (!testRuntimeUrl || !testMigrationUrl || !testStaffPassword) {
  throw new Error("Test database URLs and TEST_STAFF_PASSWORD are required");
}

const runtimeClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testRuntimeUrl }),
});
const migrationClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testMigrationUrl }),
});

afterAll(async () => {
  await Promise.all([runtimeClient.$disconnect(), migrationClient.$disconnect()]);
});

describe("Phase 1 data integrity", () => {
  it("uses dedicated test and shadow targets and refuses the application database", () => {
    expect(new URL(testRuntimeUrl).pathname).toBe("/onboarding_test");
    expect(new URL(testMigrationUrl).pathname).toBe("/onboarding_test");
    expect(new URL(process.env.SHADOW_DATABASE_URL ?? "").pathname).toBe("/onboarding_shadow");
    expect(new URL(testMigrationUrl).pathname).not.toBe("/onboarding_app");
  });

  it("keeps the seed repeatable with predictable counts", async () => {
    const first = await seedDatabase(migrationClient, testStaffPassword);
    const second = await seedDatabase(migrationClient, testStaffPassword);

    expect(first).toEqual(second);
    expect(second.users).toBeGreaterThanOrEqual(7);
    expect(second.clients).toBeGreaterThanOrEqual(1);
    expect(second.packages).toBeGreaterThanOrEqual(1);
    expect(second.onboardings).toBeGreaterThanOrEqual(1);
    expect(second.salesHandoffs).toBeGreaterThanOrEqual(1);
    expect(second.auditEvents).toBeGreaterThanOrEqual(1);
  });

  it("does not seed a premature Commercial Gate approval", async () => {
    const onboarding = await runtimeClient.onboarding.findUniqueOrThrow({
      where: { externalDealId: "DEAL-ATLAS-2026-001" },
    });

    expect(onboarding.commercialGateStatus).toBe(CommercialGateStatus.BLOCKED);
    expect(onboarding.status).toBe(OnboardingStatus.COMMERCIAL_PENDING);
    expect(onboarding.activatedAt).toBeNull();
  });

  it("preserves exact decimal payment values", async () => {
    const payment = await runtimeClient.payment.findUniqueOrThrow({
      where: { externalReference: "PAYMENT-ATLAS-001" },
    });

    expect(payment.originalAmount.toFixed(4)).toBe("2000.0000");
    expect(payment.verifiedAmount?.toFixed(4)).toBe("2000.0000");
  });

  it("rejects case-variant staff emails at the database boundary", async () => {
    await expect(
      runtimeClient.user.create({
        data: {
          name: "Uppercase Invalid",
          email: "UPPERCASE@NORTHSTAR.TEST",
          passwordHash: "not-used",
          role: Role.SALES,
          isActive: true,
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces contract version uniqueness", async () => {
    const onboarding = await runtimeClient.onboarding.findFirstOrThrow();

    await expect(
      runtimeClient.contract.create({
        data: {
          onboardingId: onboarding.id,
          status: "SIGNED",
          versionNumber: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects negative money and cross-currency payments", async () => {
    const invoice = await runtimeClient.invoice.findFirstOrThrow();
    const finance = await runtimeClient.user.findUniqueOrThrow({
      where: { email: "finance@northstar.test" },
    });

    await expect(
      runtimeClient.payment.create({
        data: {
          invoiceId: invoice.id,
          originalAmount: "-1.0000",
          currency: invoice.currency,
          verificationStatus: PaymentVerificationStatus.PENDING,
          submittedById: finance.id,
          recordingKey: "TEST-NEGATIVE-PAYMENT",
        },
      }),
    ).rejects.toThrow();

    await expect(
      runtimeClient.payment.create({
        data: {
          invoiceId: invoice.id,
          originalAmount: "1.0000",
          currency: "EUR",
          verificationStatus: PaymentVerificationStatus.PENDING,
          submittedById: finance.id,
          recordingKey: "TEST-CROSS-CURRENCY-PAYMENT",
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces required foreign keys", async () => {
    const finance = await runtimeClient.user.findUniqueOrThrow({
      where: { email: "finance@northstar.test" },
    });

    await expect(
      runtimeClient.payment.create({
        data: {
          invoiceId: "00000000-0000-0000-0000-000000000000",
          originalAmount: "1.0000",
          currency: "USD",
          verificationStatus: PaymentVerificationStatus.PENDING,
          submittedById: finance.id,
          recordingKey: "TEST-MISSING-INVOICE-PAYMENT",
        },
      }),
    ).rejects.toThrow();
  });
});

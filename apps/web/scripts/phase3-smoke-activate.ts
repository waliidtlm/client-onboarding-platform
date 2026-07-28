import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
process.loadEnvFile(path.join(repositoryRoot, ".env"));

if (process.env.NODE_ENV === "production") {
  throw new Error("The Phase 3 smoke fixture cannot run in production");
}

const { randomUUID } = await import("node:crypto");
const { PrismaPg } = await import("@prisma/adapter-pg");
const {
  ActivationRequirementStatus,
  ActivationType,
  CommercialGateStatus,
  ContractStatus,
  DealStatus,
  InvoiceStatus,
  OnboardingStatus,
  PaymentVerificationStatus,
  PrismaClient,
} = await import("../src/generated/prisma/client");
const { activateOnboarding } =
  await import("../src/application/commercial/commercial-gate-service");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/onboarding_app") {
  throw new Error("DATABASE_URL must target the local onboarding_app database");
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

try {
  const [existing, sales, finance, admin] = await Promise.all([
    database.onboarding.findFirstOrThrow(),
    database.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    database.user.findUniqueOrThrow({ where: { email: "finance@northstar.test" } }),
    database.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
  ]);
  const suffix = randomUUID();
  const onboarding = await database.onboarding.create({
    data: {
      clientId: existing.clientId,
      servicePackageId: existing.servicePackageId,
      externalDealId: `PHASE3-SMOKE-${suffix}`,
      dealStatus: DealStatus.CLOSED_WON,
      salesHandoffStatus: "COMPLETE",
      commercialGateStatus: CommercialGateStatus.BLOCKED,
      status: OnboardingStatus.COMMERCIAL_PENDING,
      submittedById: sales.id,
      invoiceTotal: "1.0000",
      currency: "USD",
      servicePackageNameSnapshot: "Phase 3 smoke package",
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
  const invoice = await database.invoice.create({
    data: {
      onboardingId: onboarding.id,
      status: InvoiceStatus.ISSUED,
      invoiceNumber: `PHASE3-SMOKE-${suffix}`,
      totalAmount: "1.0000",
      currency: "USD",
      dueAt: new Date("2026-12-01T23:59:59.000Z"),
    },
  });
  await database.payment.create({
    data: {
      invoiceId: invoice.id,
      originalAmount: "1.0000",
      verifiedAmount: "1.0000",
      currency: "USD",
      verificationStatus: PaymentVerificationStatus.VERIFIED,
      submittedById: finance.id,
      verifiedById: finance.id,
      verifiedAt: new Date(),
      recordingKey: randomUUID(),
    },
  });
  await database.onboarding.update({
    where: { id: onboarding.id },
    data: { activationInvoiceId: invoice.id },
  });

  const activation = await activateOnboarding(
    {
      actorId: admin.id,
      onboardingId: onboarding.id,
      expectedVersion: onboarding.version,
      correlationId: randomUUID(),
    },
    database,
  );
  if (!activation.ok || !activation.value.automationEvent) {
    throw new Error(
      activation.ok
        ? "Activation did not append an automation event"
        : `${activation.error.code}: ${activation.error.message}`,
    );
  }
  console.log(
    JSON.stringify({
      onboardingId: onboarding.id,
      eventId: activation.value.automationEvent.eventId,
    }),
  );
} finally {
  await database.$disconnect();
}

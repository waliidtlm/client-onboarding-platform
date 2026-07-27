import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import {
  ActivationRequirementStatus,
  ActivationType,
  CommercialGateStatus,
  ContractStatus,
  DealStatus,
  InvoiceStatus,
  OnboardingStatus,
  PaymentVerificationStatus,
  PrismaClient,
  RequirementInputType,
  Role,
  SalesHandoffStatus,
} from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const seedEnvironmentSchema = z.object({
  DEMO_STAFF_PASSWORD: z.string().min(12),
  MIGRATION_DATABASE_URL: z.url().optional(),
  DATABASE_URL: z.url().optional(),
});

type SeedClient = PrismaClient;

const staff = [
  ["Northstar Administrator", "admin@northstar.test", Role.ADMIN, true],
  ["Northstar Sales", "sales@northstar.test", Role.SALES, true],
  ["Northstar Operations", "operations@northstar.test", Role.OPERATIONS, true],
  ["Northstar Finance", "finance@northstar.test", Role.FINANCE, true],
  ["Northstar Project Manager", "pm@northstar.test", Role.PROJECT_MANAGER, true],
  ["Northstar Delivery", "delivery@northstar.test", Role.DELIVERY, true],
  ["Disabled Demo User", "disabled@northstar.test", Role.DELIVERY, false],
] as const;

const provisioningTemplates = [
  ["Create client workspace", "Prepare the internal client workspace.", "CREATE_CLIENT_WORKSPACE"],
  [
    "Create campaign project",
    "Prepare the paid-growth campaign project.",
    "CREATE_CAMPAIGN_PROJECT",
  ],
  ["Create shared asset folder", "Prepare the shared asset folder.", "CREATE_ASSET_FOLDER"],
  ["Create internal launch checklist", "Prepare the launch checklist.", "CREATE_LAUNCH_CHECKLIST"],
] as const;

const requirementTemplates = [
  ["Brand guidelines", RequirementInputType.FILE, true],
  ["Advertising account access", RequirementInputType.TEXT, true],
  ["Campaign goals", RequirementInputType.TEXT, true],
  ["Target customer description", RequirementInputType.TEXT, true],
  ["Approved budget", RequirementInputType.TEXT, true],
  ["Existing creative assets", RequirementInputType.MULTI_FILE, true],
  ["Competitor examples", RequirementInputType.URL, false],
  ["Previous campaign reports", RequirementInputType.MULTI_FILE, false],
] as const;

export async function seedDatabase(
  client: SeedClient,
  demoPassword: string,
): Promise<Record<string, number>> {
  const passwordHash = await hashPassword(demoPassword);

  return client.$transaction(async (tx) => {
    const users = new Map<string, { id: string }>();

    for (const [name, email, role, isActive] of staff) {
      const user = await tx.user.upsert({
        where: { email },
        create: { name, email, passwordHash, role, isActive },
        update: { name, passwordHash, role, isActive },
        select: { id: true },
      });
      users.set(email, user);
    }

    const clientRecord = await tx.client.upsert({
      where: { companyName: "Atlas Fitness Studio" },
      create: {
        companyName: "Atlas Fitness Studio",
        contactName: "Jordan Atlas",
        contactEmail: "operations@atlas-fitness.test",
        contactPhone: "+1-555-0100",
      },
      update: {
        contactName: "Jordan Atlas",
        contactEmail: "operations@atlas-fitness.test",
        contactPhone: "+1-555-0100",
      },
    });

    const servicePackage = await tx.servicePackage.upsert({
      where: { name: "Paid Growth Launch" },
      create: {
        name: "Paid Growth Launch",
        description: "A structured paid-advertising launch package for a new agency client.",
        isActive: true,
        activationType: ActivationType.DEPOSIT_PERCENTAGE,
        activationValue: "30.0000",
      },
      update: {
        description: "A structured paid-advertising launch package for a new agency client.",
        isActive: true,
        activationType: ActivationType.DEPOSIT_PERCENTAGE,
        activationValue: "30.0000",
      },
    });

    for (const [index, template] of provisioningTemplates.entries()) {
      const [name, description, automationKey] = template;
      const sequence = index + 1;
      await tx.packageProvisioningTemplate.upsert({
        where: {
          servicePackageId_sequence: {
            servicePackageId: servicePackage.id,
            sequence,
          },
        },
        create: {
          servicePackageId: servicePackage.id,
          name,
          description,
          sequence,
          isRequired: true,
          automationKey,
        },
        update: { name, description, isRequired: true, automationKey },
      });
    }

    for (const [index, template] of requirementTemplates.entries()) {
      const [name, inputType, isRequired] = template;
      const sequence = index + 1;
      await tx.packageRequirementTemplate.upsert({
        where: {
          servicePackageId_sequence: {
            servicePackageId: servicePackage.id,
            sequence,
          },
        },
        create: {
          servicePackageId: servicePackage.id,
          name,
          description: `Provide ${name.toLowerCase()} for the paid-growth launch.`,
          inputType,
          isRequired,
          sequence,
          dueOffsetDays: 5,
        },
        update: {
          name,
          description: `Provide ${name.toLowerCase()} for the paid-growth launch.`,
          inputType,
          isRequired,
          dueOffsetDays: 5,
        },
      });
    }

    const salesUser = users.get("sales@northstar.test");
    const operationsUser = users.get("operations@northstar.test");
    const financeUser = users.get("finance@northstar.test");

    if (!salesUser || !operationsUser || !financeUser) {
      throw new Error("Required fictional staff were not seeded");
    }

    const onboarding = await tx.onboarding.upsert({
      where: { externalDealId: "DEAL-ATLAS-2026-001" },
      create: {
        clientId: clientRecord.id,
        servicePackageId: servicePackage.id,
        externalDealId: "DEAL-ATLAS-2026-001",
        dealStatus: DealStatus.CLOSED_WON,
        salesHandoffStatus: SalesHandoffStatus.COMPLETE,
        commercialGateStatus: CommercialGateStatus.BLOCKED,
        status: OnboardingStatus.COMMERCIAL_PENDING,
        projectManagerId: null,
        submittedById: salesUser.id,
        validatedById: operationsUser.id,
        invoiceTotal: "10000.0000",
        currency: "USD",
        activationRequiredAmount: "3000.0000",
        activationRequirementStatus: ActivationRequirementStatus.NOT_SATISFIED,
      },
      update: {
        clientId: clientRecord.id,
        servicePackageId: servicePackage.id,
        dealStatus: DealStatus.CLOSED_WON,
        salesHandoffStatus: SalesHandoffStatus.COMPLETE,
        commercialGateStatus: CommercialGateStatus.BLOCKED,
        status: OnboardingStatus.COMMERCIAL_PENDING,
        projectManagerId: null,
        submittedById: salesUser.id,
        validatedById: operationsUser.id,
        invoiceTotal: "10000.0000",
        currency: "USD",
        activationRequiredAmount: "3000.0000",
        activationRequirementStatus: ActivationRequirementStatus.NOT_SATISFIED,
        activatedAt: null,
      },
    });

    await tx.contract.upsert({
      where: {
        onboardingId_versionNumber: {
          onboardingId: onboarding.id,
          versionNumber: 1,
        },
      },
      create: {
        onboardingId: onboarding.id,
        status: ContractStatus.SIGNED,
        versionNumber: 1,
        signedAt: new Date("2026-07-20T10:00:00.000Z"),
        externalReference: "CONTRACT-ATLAS-001",
      },
      update: {
        status: ContractStatus.SIGNED,
        signedAt: new Date("2026-07-20T10:00:00.000Z"),
        externalReference: "CONTRACT-ATLAS-001",
      },
    });

    const invoice = await tx.invoice.upsert({
      where: { invoiceNumber: "NS-2026-0001" },
      create: {
        onboardingId: onboarding.id,
        status: InvoiceStatus.PARTIALLY_PAID,
        invoiceNumber: "NS-2026-0001",
        totalAmount: "10000.0000",
        currency: "USD",
        dueAt: new Date("2026-08-15T23:59:59.000Z"),
        externalReference: "INVOICE-ATLAS-001",
      },
      update: {
        onboardingId: onboarding.id,
        status: InvoiceStatus.PARTIALLY_PAID,
        totalAmount: "10000.0000",
        currency: "USD",
        dueAt: new Date("2026-08-15T23:59:59.000Z"),
        externalReference: "INVOICE-ATLAS-001",
      },
    });

    await tx.payment.upsert({
      where: { externalReference: "PAYMENT-ATLAS-001" },
      create: {
        invoiceId: invoice.id,
        originalAmount: "2000.0000",
        verifiedAmount: "2000.0000",
        currency: "USD",
        verificationStatus: PaymentVerificationStatus.VERIFIED,
        submittedById: financeUser.id,
        verifiedById: financeUser.id,
        verifiedAt: new Date("2026-07-22T14:30:00.000Z"),
        externalReference: "PAYMENT-ATLAS-001",
      },
      update: {
        invoiceId: invoice.id,
        verifiedAmount: "2000.0000",
        currency: "USD",
        verificationStatus: PaymentVerificationStatus.VERIFIED,
        submittedById: financeUser.id,
        verifiedById: financeUser.id,
        verifiedAt: new Date("2026-07-22T14:30:00.000Z"),
      },
    });

    const seededOnboarding = await tx.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
      select: { commercialGateStatus: true, status: true, activatedAt: true },
    });

    if (
      seededOnboarding.commercialGateStatus !== CommercialGateStatus.BLOCKED ||
      seededOnboarding.status !== OnboardingStatus.COMMERCIAL_PENDING ||
      seededOnboarding.activatedAt !== null
    ) {
      throw new Error("Phase 1 seed attempted to create a premature activated onboarding");
    }

    const [
      userCount,
      clientCount,
      packageCount,
      provisioningTemplateCount,
      requirementTemplateCount,
      onboardingCount,
      contractCount,
      invoiceCount,
      paymentCount,
    ] = await Promise.all([
      tx.user.count(),
      tx.client.count(),
      tx.servicePackage.count(),
      tx.packageProvisioningTemplate.count(),
      tx.packageRequirementTemplate.count(),
      tx.onboarding.count(),
      tx.contract.count(),
      tx.invoice.count(),
      tx.payment.count(),
    ]);

    return {
      users: userCount,
      clients: clientCount,
      packages: packageCount,
      provisioningTemplates: provisioningTemplateCount,
      requirementTemplates: requirementTemplateCount,
      onboardings: onboardingCount,
      contracts: contractCount,
      invoices: invoiceCount,
      payments: paymentCount,
    };
  });
}

async function main(): Promise<void> {
  const environment = seedEnvironmentSchema.parse(process.env);
  const connectionString = environment.MIGRATION_DATABASE_URL ?? environment.DATABASE_URL;

  if (!connectionString || new URL(connectionString).pathname !== "/onboarding_app") {
    throw new Error("Demo seed must target onboarding_app");
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const counts = await seedDatabase(client, environment.DEMO_STAFF_PASSWORD);
    process.stdout.write(`Phase 1 demo seed complete: ${JSON.stringify(counts)}\n`);
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

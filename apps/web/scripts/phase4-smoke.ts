import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
process.loadEnvFile(path.join(repositoryRoot, ".env"));

if (process.env.NODE_ENV === "production") {
  throw new Error("The Phase 4 smoke fixture cannot run in production");
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
  NotificationStatus,
  OnboardingStatus,
  PaymentVerificationStatus,
  PrismaClient,
  ProvisioningTaskStatus,
} = await import("../src/generated/prisma/client");
const { activateOnboarding } =
  await import("../src/application/commercial/commercial-gate-service");
const { approveInternalReadiness } =
  await import("../src/application/notifications/welcome-email-service");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/onboarding_app") {
  throw new Error("DATABASE_URL must target the local onboarding_app database");
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function createCommerciallyApprovedFixture(input: {
  suffix: string;
  label: string;
  clientId: string;
  servicePackageId: string;
  packageName: string;
  salesId: string;
  financeId: string;
  adminId: string;
  projectManagerId: string;
}) {
  const onboarding = await database.onboarding.create({
    data: {
      clientId: input.clientId,
      servicePackageId: input.servicePackageId,
      externalDealId: `${input.label}-${input.suffix}`,
      dealStatus: DealStatus.CLOSED_WON,
      salesHandoffStatus: "COMPLETE",
      commercialGateStatus: CommercialGateStatus.BLOCKED,
      status: OnboardingStatus.COMMERCIAL_PENDING,
      projectManagerId: input.projectManagerId,
      submittedById: input.salesId,
      invoiceTotal: "10.0000",
      currency: "USD",
      servicePackageNameSnapshot: input.packageName,
      activationTypeSnapshot: ActivationType.FULL_PAYMENT_PERCENTAGE,
      activationValueSnapshot: "100.0000",
      activationRequiredAmount: "10.0000",
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
      invoiceNumber: `${input.label}-${input.suffix}`,
      totalAmount: "10.0000",
      currency: "USD",
      dueAt: new Date("2026-12-01T23:59:59.000Z"),
    },
  });
  await database.payment.create({
    data: {
      invoiceId: invoice.id,
      originalAmount: "10.0000",
      verifiedAmount: "10.0000",
      currency: "USD",
      verificationStatus: PaymentVerificationStatus.VERIFIED,
      submittedById: input.financeId,
      verifiedById: input.financeId,
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
      actorId: input.adminId,
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
  return {
    onboardingId: onboarding.id,
    eventId: activation.value.automationEvent.eventId,
  };
}

try {
  const suffix = randomUUID();
  const [sales, finance, admin, projectManager] = await Promise.all([
    database.user.findUniqueOrThrow({ where: { email: "sales@northstar.test" } }),
    database.user.findUniqueOrThrow({ where: { email: "finance@northstar.test" } }),
    database.user.findUniqueOrThrow({ where: { email: "admin@northstar.test" } }),
    database.user.findUniqueOrThrow({ where: { email: "pm@northstar.test" } }),
  ]);
  const [happyClient, manualClient] = await Promise.all([
    database.client.create({
      data: {
        companyName: `Phase 4 Happy Smoke ${suffix}`,
        contactName: "Happy Path Client",
        contactEmail: `phase4-happy-${suffix}@example.test`,
      },
    }),
    database.client.create({
      data: {
        companyName: `Phase 4 Manual Smoke ${suffix}`,
        contactName: "Manual Review Client",
        contactEmail: `phase4-manual-${suffix}@example.test`,
      },
    }),
  ]);
  const [happyPackage, manualPackage] = await Promise.all([
    database.servicePackage.create({
      data: {
        name: `Phase 4 Happy Smoke ${suffix}`,
        description: "Isolated Phase 4 happy-path smoke package.",
        isActive: true,
        activationType: ActivationType.FULL_PAYMENT_PERCENTAGE,
        activationValue: "100.0000",
        provisioningTemplates: {
          create: [
            {
              name: "Create client workspace",
              description: "Local sandbox resource.",
              sequence: 1,
              isRequired: true,
              automationKey: "CREATE_CLIENT_WORKSPACE",
            },
            {
              name: "Create campaign project",
              description: "Local sandbox resource with one deterministic transient failure.",
              sequence: 2,
              isRequired: true,
              automationKey: "CREATE_CAMPAIGN_PROJECT",
            },
            {
              name: "Create shared asset folder",
              description: "Local sandbox resource.",
              sequence: 3,
              isRequired: true,
              automationKey: "CREATE_ASSET_FOLDER",
            },
            {
              name: "Create launch checklist",
              description: "Local sandbox resource.",
              sequence: 4,
              isRequired: true,
              automationKey: "CREATE_LAUNCH_CHECKLIST",
            },
          ],
        },
      },
    }),
    database.servicePackage.create({
      data: {
        name: `Phase 4 Manual Smoke ${suffix}`,
        description: "Isolated Phase 4 manual-review smoke package.",
        isActive: true,
        activationType: ActivationType.FULL_PAYMENT_PERCENTAGE,
        activationValue: "100.0000",
        provisioningTemplates: {
          create: {
            name: "Manual review demo task",
            description: "Local sandbox resource permanent-failure scenario.",
            sequence: 1,
            isRequired: true,
            automationKey: "MANUAL_REVIEW_DEMO",
          },
        },
      },
    }),
  ]);

  const common = {
    suffix,
    salesId: sales.id,
    financeId: finance.id,
    adminId: admin.id,
    projectManagerId: projectManager.id,
  };
  const happy = await createCommerciallyApprovedFixture({
    ...common,
    label: "PHASE4-HAPPY-SMOKE",
    clientId: happyClient.id,
    servicePackageId: happyPackage.id,
    packageName: happyPackage.name,
  });
  const manual = await createCommerciallyApprovedFixture({
    ...common,
    label: "PHASE4-MANUAL-SMOKE",
    clientId: manualClient.id,
    servicePackageId: manualPackage.id,
    packageName: manualPackage.name,
  });
  process.stdout.write(`${JSON.stringify({ phase: "FIXTURES_CREATED", happy, manual, suffix })}\n`);

  const deadline = Date.now() + 12 * 60 * 1_000;
  let approvalCreated = false;
  while (Date.now() < deadline) {
    const [happyState, manualState] = await Promise.all([
      database.onboarding.findUniqueOrThrow({
        where: { id: happy.onboardingId },
        include: {
          provisioningTasks: { orderBy: { sequence: "asc" } },
          notificationLogs: true,
        },
      }),
      database.onboarding.findUniqueOrThrow({
        where: { id: manual.onboardingId },
        include: { provisioningTasks: true },
      }),
    ]);
    if (happyState.status === OnboardingStatus.INTERNAL_REVIEW && !approvalCreated) {
      const approval = await approveInternalReadiness(
        {
          actorId: projectManager.id,
          onboardingId: happyState.id,
          expectedVersion: happyState.version,
          note: "Real local Phase 4 n8n and Mailpit smoke verification.",
          correlationId: randomUUID(),
        },
        database,
      );
      if (!approval.ok) {
        throw new Error(`${approval.error.code}: ${approval.error.message}`);
      }
      approvalCreated = true;
      process.stdout.write(
        `${JSON.stringify({ phase: "READINESS_APPROVED", notificationId: approval.value.notificationId })}\n`,
      );
    }
    const manualReachedReview =
      manualState.provisioningTasks.length === 1 &&
      manualState.provisioningTasks[0]?.status === ProvisioningTaskStatus.MANUAL_REVIEW_REQUIRED;
    const happyCompleted =
      happyState.status === OnboardingStatus.CLIENT_AWAITING_ACTION &&
      happyState.notificationLogs.some((item) => item.status === NotificationStatus.SENT);
    if (happyCompleted && manualReachedReview) {
      const happyEvents = await database.automationEvent.findMany({
        where: { aggregateId: happyState.id },
        include: { runs: { orderBy: { attemptNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      });
      const manualEvents = await database.automationEvent.findMany({
        where: { aggregateId: manualState.id },
        include: { runs: { orderBy: { attemptNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      });
      process.stdout.write(
        `${JSON.stringify({
          phase: "COMPLETE",
          suffix,
          happy: {
            onboardingId: happyState.id,
            status: happyState.status,
            tasks: happyState.provisioningTasks.map((task) => ({
              sequence: task.sequence,
              status: task.status,
              attempts: task.attemptCount,
              externalReference: task.externalReference,
            })),
            notifications: happyState.notificationLogs.map((notification) => ({
              id: notification.id,
              status: notification.status,
              recipient: notification.recipient,
              subject: notification.subject,
              messageKey: notification.messageKey,
            })),
            events: happyEvents.map((event) => ({
              id: event.id,
              type: event.eventType,
              status: event.status,
              attempts: event.attemptCount,
              runs: event.runs.map((run) => ({
                status: run.status,
                attempt: run.attemptNumber,
                executionId: run.n8nExecutionId,
              })),
            })),
          },
          manual: {
            onboardingId: manualState.id,
            status: manualState.status,
            tasks: manualState.provisioningTasks.map((task) => ({
              id: task.id,
              status: task.status,
              attempts: task.attemptCount,
            })),
            events: manualEvents.map((event) => ({
              id: event.id,
              type: event.eventType,
              status: event.status,
              attempts: event.attemptCount,
              runs: event.runs.map((run) => ({
                status: run.status,
                attempt: run.attemptNumber,
                executionId: run.n8nExecutionId,
              })),
            })),
          },
        })}\n`,
      );
      process.exitCode = 0;
      break;
    }
    await sleep(5_000);
  }
  if (Date.now() >= deadline) {
    throw new Error("Timed out waiting for the Phase 4 n8n smoke scenarios");
  }
} finally {
  await database.$disconnect();
}

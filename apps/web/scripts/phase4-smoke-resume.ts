import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
process.loadEnvFile(path.join(repositoryRoot, ".env"));

if (process.env.NODE_ENV === "production") {
  throw new Error("The Phase 4 smoke evidence helper cannot run in production");
}

const [happyOnboardingId, manualOnboardingId] = process.argv
  .slice(2)
  .filter((argument) => argument !== "--");
if (!happyOnboardingId || !manualOnboardingId) {
  throw new Error("Provide the isolated happy and manual-review onboarding IDs");
}

const { randomUUID } = await import("node:crypto");
const { PrismaPg } = await import("@prisma/adapter-pg");
const { NotificationStatus, OnboardingStatus, PrismaClient, ProvisioningTaskStatus } =
  await import("../src/generated/prisma/client");
const { approveInternalReadiness } =
  await import("../src/application/notifications/welcome-email-service");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== "/onboarding_app") {
  throw new Error("DATABASE_URL must target the local onboarding_app database");
}
const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

try {
  const projectManager = await database.user.findUniqueOrThrow({
    where: { email: "pm@northstar.test" },
  });
  let happy = await database.onboarding.findUniqueOrThrow({
    where: { id: happyOnboardingId },
  });
  if (!happy.internalReadinessApprovedAt) {
    if (happy.status !== OnboardingStatus.INTERNAL_REVIEW) {
      throw new Error(`Happy-path onboarding is ${happy.status}, not INTERNAL_REVIEW`);
    }
    const approval = await approveInternalReadiness(
      {
        actorId: projectManager.id,
        onboardingId: happy.id,
        expectedVersion: happy.version,
        note: "Real local Phase 4 n8n and Mailpit smoke verification.",
        correlationId: randomUUID(),
      },
      database,
    );
    if (!approval.ok) {
      throw new Error(`${approval.error.code}: ${approval.error.message}`);
    }
  }

  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    happy = await database.onboarding.findUniqueOrThrow({
      where: { id: happyOnboardingId },
    });
    if (happy.status === OnboardingStatus.CLIENT_AWAITING_ACTION) break;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  const [happyEvidence, manualEvidence] = await Promise.all([
    database.onboarding.findUniqueOrThrow({
      where: { id: happyOnboardingId },
      include: {
        provisioningTasks: {
          include: { attempts: { orderBy: { attemptNumber: "asc" } } },
          orderBy: { sequence: "asc" },
        },
        notificationLogs: true,
        automationEvents: {
          include: { runs: { orderBy: { attemptNumber: "asc" } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    database.onboarding.findUniqueOrThrow({
      where: { id: manualOnboardingId },
      include: {
        provisioningTasks: true,
        automationEvents: {
          include: { runs: { orderBy: { attemptNumber: "asc" } } },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);
  if (
    happyEvidence.status !== OnboardingStatus.CLIENT_AWAITING_ACTION ||
    !happyEvidence.notificationLogs.some((item) => item.status === NotificationStatus.SENT)
  ) {
    throw new Error("The happy-path welcome delivery did not complete");
  }
  if (
    manualEvidence.provisioningTasks.length !== 1 ||
    manualEvidence.provisioningTasks[0]?.status !== ProvisioningTaskStatus.MANUAL_REVIEW_REQUIRED
  ) {
    throw new Error("The isolated manual-review task did not reach manual review");
  }
  process.stdout.write(
    `${JSON.stringify({
      happy: {
        onboardingId: happyEvidence.id,
        status: happyEvidence.status,
        tasks: happyEvidence.provisioningTasks.map((task) => ({
          sequence: task.sequence,
          status: task.status,
          attemptCount: task.attemptCount,
          attemptStatuses: task.attempts.map((attempt) => attempt.status),
          externalReference: task.externalReference,
        })),
        notifications: happyEvidence.notificationLogs.map((notification) => ({
          id: notification.id,
          status: notification.status,
          recipient: notification.recipient,
          subject: notification.subject,
          textContent: notification.textContent,
          providerReference: notification.providerReference,
        })),
        events: happyEvidence.automationEvents.map((event) => ({
          type: event.eventType,
          status: event.status,
          attemptCount: event.attemptCount,
          runExecutionIds: event.runs.map((run) => run.n8nExecutionId),
        })),
      },
      manual: {
        onboardingId: manualEvidence.id,
        status: manualEvidence.status,
        tasks: manualEvidence.provisioningTasks.map((task) => ({
          status: task.status,
          attemptCount: task.attemptCount,
        })),
        events: manualEvidence.automationEvents.map((event) => ({
          type: event.eventType,
          status: event.status,
          attemptCount: event.attemptCount,
          runStatuses: event.runs.map((run) => run.status),
        })),
      },
    })}\n`,
  );
} finally {
  await database.$disconnect();
}

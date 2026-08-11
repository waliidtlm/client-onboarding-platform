import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const DATABASE_NAME = "onboarding_phase7_demo";
const FIXTURE_MARKER = "PHASE7_DEMO_FIXTURE_v1";
const databaseUrl = process.env.DATABASE_URL;

if (
  !databaseUrl ||
  new URL(databaseUrl).pathname !== `/${DATABASE_NAME}` ||
  process.env.PHASE7_DEMO_FIXTURE_MARKER !== FIXTURE_MARKER
) {
  throw new Error("Phase 7 verification refused: isolated database name or marker is not exact");
}

const database = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

try {
  const onboarding = await database.onboarding.findUnique({
    where: { externalDealId: FIXTURE_MARKER },
    include: {
      client: true,
      clientAccessTokens: true,
      clientRequirements: {
        orderBy: { sequence: "asc" },
        include: { submissions: { orderBy: { submissionVersion: "asc" } } },
      },
      provisioningTasks: { orderBy: { sequence: "asc" } },
      kickoff: true,
      deliveryHandoff: true,
      auditEvents: { orderBy: { createdAt: "asc" } },
      automationEvents: true,
    },
  });
  invariant(onboarding, "Exact Phase 7 fixture is missing");
  invariant(onboarding.client?.contactEmail.endsWith(".test"), "Fixture recipient is not .test");
  invariant(onboarding.status === "COMPLETED", "Lifecycle did not reach COMPLETED");
  invariant(onboarding.completedAt, "Completion time is missing");
  invariant(onboarding.kickoff?.status === "COMPLETED", "Kickoff is not complete");
  invariant(
    onboarding.deliveryHandoff?.status === "ACKNOWLEDGED",
    "Delivery handoff is not acknowledged",
  );
  invariant(
    onboarding.clientAccessTokens.every((token) => token.revokedAt),
    "Client access was not revoked",
  );
  invariant(
    onboarding.provisioningTasks.some((task) => task.attemptCount === 2),
    "Transient provisioning retry evidence is missing",
  );
  invariant(
    onboarding.clientRequirements.some(
      (requirement) =>
        requirement.submissions.length === 2 &&
        requirement.submissions[0]?.reviewDecision === "REJECTED" &&
        requirement.submissions[1]?.reviewDecision === "APPROVED",
    ),
    "Rejected and corrected submission evidence is missing",
  );
  invariant(
    onboarding.automationEvents.some((event) => event.status === "DEAD_LETTER"),
    "Dead-letter recovery evidence is missing",
  );
  const requiredActions = [
    "SALES_HANDOFF_CORRECTED",
    "ONBOARDING_ACTIVATED",
    "PROVISIONING_TASK_ATTEMPT_FAILED",
    "PROVISIONING_TASK_RETRIED",
    "INTERNAL_READINESS_APPROVED",
    "CLIENT_ACCESS_ISSUED",
    "CLIENT_REQUIREMENT_REJECTED",
    "CLIENT_REQUIREMENT_CORRECTED",
    "CLIENT_REQUIREMENTS_COMPLETED",
    "KICKOFF_COMPLETED",
    "DELIVERY_HANDOFF_ACKNOWLEDGED",
    "CLIENT_ACCESS_REVOKED",
    "ONBOARDING_COMPLETED",
  ];
  const actualActions = new Set(onboarding.auditEvents.map((event) => event.action));
  invariant(
    requiredActions.every((action) => actualActions.has(action)),
    "Terminal audit history is incomplete",
  );

  const [reminders, allNotifications] = await Promise.all([
    database.notificationLog.findMany({
      where: { notificationType: "CLIENT_REQUIREMENT" },
    }),
    database.notificationLog.findMany({ select: { recipient: true } }),
  ]);
  invariant(reminders.length >= 1, "Reminder workflow did not materialize a notification");
  invariant(
    allNotifications.every((notification) => notification.recipient.endsWith(".test")),
    "A demo notification recipient is not .test",
  );

  process.stdout.write(
    `${JSON.stringify({
      fixture: FIXTURE_MARKER,
      onboardingId: onboarding.id,
      status: onboarding.status,
      auditEvents: onboarding.auditEvents.length,
      provisioningTasks: onboarding.provisioningTasks.length,
      requirementVersions: onboarding.clientRequirements.reduce(
        (total, requirement) => total + requirement.submissions.length,
        0,
      ),
      reminders: reminders.length,
      clientAccessRevoked: true,
    })}\n`,
  );
} finally {
  await database.$disconnect();
}

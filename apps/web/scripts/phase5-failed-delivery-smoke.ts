import "dotenv/config";

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  ActivationRequirementStatus,
  CommercialGateStatus,
  DealStatus,
  OnboardingStatus,
  SalesHandoffStatus,
} from "../src/generated/prisma/client";
import { manageClientAccess } from "../src/application/client-access/access-service";
import { reconstructCapabilityToken } from "../src/domain/client-access/token";
import { clientAccessSigningKey } from "../src/lib/client-access/keys";
import { prisma } from "../src/lib/database";

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function waitForUncertain(notificationId: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const notification = await prisma.notificationLog.findUnique({
      where: { id: notificationId },
    });
    if (notification?.status === "DELIVERY_UNCERTAIN") return notification;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for failed SMTP delivery");
}

async function main() {
  await prisma.automationEvent.updateMany({
    where: {
      eventType: "CLIENT_ACCESS_EMAIL_REQUESTED",
      status: "PENDING",
      onboarding: { client: { companyName: { startsWith: "Phase 5 Failed Delivery" } } },
    },
    data: { availableAt: new Date("2099-01-01T00:00:00.000Z") },
  });
  const [admin, projectManager, sales, servicePackage] = await Promise.all([
    prisma.user.findUnique({ where: { email: "admin@northstar.test" } }),
    prisma.user.findUnique({ where: { email: "pm@northstar.test" } }),
    prisma.user.findUnique({ where: { email: "sales@northstar.test" } }),
    prisma.servicePackage.findUnique({ where: { name: "Paid Growth Launch" } }),
  ]);
  invariant(admin && projectManager && sales && servicePackage, "Seeded prerequisites missing");
  const suffix = `${Date.now()}-${randomUUID()}`;
  const client = await prisma.client.create({
    data: {
      companyName: `Phase 5 Failed Delivery ${suffix}`,
      contactName: "Failure Test Client",
      contactEmail: `phase5-failed-${suffix}@northstar.test`,
    },
  });
  const onboarding = await prisma.onboarding.create({
    data: {
      clientId: client.id,
      servicePackageId: servicePackage.id,
      externalDealId: `PHASE5-FAILED-${suffix}`,
      dealStatus: DealStatus.CLOSED_WON,
      salesHandoffStatus: SalesHandoffStatus.COMPLETE,
      commercialGateStatus: CommercialGateStatus.APPROVED,
      commercialGateBlockingReasons: [],
      status: OnboardingStatus.CLIENT_AWAITING_ACTION,
      projectManagerId: projectManager.id,
      submittedById: sales.id,
      validatedById: admin.id,
      invoiceTotal: "10000.0000",
      currency: "USD",
      servicePackageNameSnapshot: servicePackage.name,
      activationTypeSnapshot: servicePackage.activationType,
      activationValueSnapshot: servicePackage.activationValue,
      activationRequiredAmount: "3000.0000",
      activationRequirementStatus: ActivationRequirementStatus.SATISFIED,
      activatedAt: new Date(),
      welcomeEmailSentAt: new Date(),
    },
  });
  const issued = await manageClientAccess({
    actorId: projectManager.id,
    onboardingId: onboarding.id,
    expectedVersion: onboarding.version,
    issuanceKey: `PHASE5-FAILED:${randomUUID()}`,
    operation: "ISSUE",
    correlationId: randomUUID(),
  });
  invariant(issued.ok, "Failed-delivery access issuance failed");
  const notification = await waitForUncertain(issued.value.notificationId);
  const token = await prisma.clientAccessToken.findUniqueOrThrow({
    where: { id: issued.value.clientAccessTokenId },
  });
  const signingKey = clientAccessSigningKey(token.signingKeyVersion);
  invariant(signingKey, "Signing key unavailable");
  const rawToken = reconstructCapabilityToken(token, signingKey);
  const [current, requirements, events, runs, audit] = await Promise.all([
    prisma.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } }),
    prisma.clientRequirement.findMany({ where: { onboardingId: onboarding.id } }),
    prisma.automationEvent.findMany({ where: { aggregateId: onboarding.id } }),
    prisma.automationRun.findMany({
      where: { automationEvent: { aggregateId: onboarding.id } },
    }),
    prisma.auditEvent.findMany({ where: { onboardingId: onboarding.id } }),
  ]);
  invariant(current.clientAccessDeliveredAt === null, "Failed delivery set a delivery timestamp");
  invariant(
    requirements.every((requirement) => requirement.dueAt === null),
    "Failed delivery set due dates",
  );
  invariant(
    !JSON.stringify({ token, notification, events, runs, audit }).includes(rawToken),
    "Failed delivery persisted the bearer in the application database",
  );
  const logs = spawnSync("docker", ["compose", "--env-file", ".env", "logs", "--no-color", "web"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  invariant(
    logs.status === 0 && !logs.stdout.includes(rawToken),
    "Failed delivery logged the bearer",
  );
  const n8nScan = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "platform_admin",
      "-d",
      "n8n_internal",
      "-At",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: `SELECT count(*) FROM execution_data WHERE position($capability$${rawToken}$capability$ in data) > 0;\n`,
    },
  );
  invariant(
    n8nScan.status === 0 && n8nScan.stdout.trim() === "0",
    "Failed delivery persisted the bearer in n8n",
  );
  process.stdout.write(
    `${JSON.stringify({
      onboardingId: onboarding.id,
      notificationStatus: notification.status,
      dueDatesRemainNull: true,
      rawBearerPersisted: false,
    })}\n`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}

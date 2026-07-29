import "dotenv/config";

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { scheduleKickoff } from "@/application/phase6/kickoff-service";
import { prisma } from "@/lib/database";

const mailpitApi = "http://127.0.0.1:8025/api/v1";

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function dockerCompose(...args: string[]): void {
  const command = spawnSync("docker", ["compose", "--env-file", ".env", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  invariant(
    command.status === 0,
    `docker compose ${args.join(" ")} failed: ${command.stderr || command.stdout}`,
  );
}

async function waitFor<T>(
  work: () => Promise<T | null>,
  label: string,
  timeoutMs = 240_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await work();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function mailpitRecipientCount(recipient: string): Promise<number> {
  const response = await fetch(`${mailpitApi}/messages`);
  invariant(response.ok, "Mailpit message query failed");
  const inbox = (await response.json()) as {
    messages?: Array<{ To?: Array<{ Address?: string }> }>;
  };
  return (
    inbox.messages?.filter((message) =>
      message.To?.some((address) => address.Address === recipient),
    ).length ?? 0
  );
}

async function waitForMailpit(): Promise<void> {
  await waitFor(
    async () => {
      try {
        const response = await fetch(`${mailpitApi}/info`);
        return response.ok ? true : null;
      } catch {
        return null;
      }
    },
    "Mailpit restart",
    60_000,
  );
}

async function main() {
  const existingUncertain = await prisma.onboarding.findFirst({
    where: {
      status: "KICKOFF_PENDING",
      client: { companyName: { startsWith: "Phase 5 Smoke " } },
      kickoff: {
        is: {
          status: "SCHEDULED",
          notifications: {
            some: {
              notificationType: "KICKOFF_INVITATION",
              status: "DELIVERY_UNCERTAIN",
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    include: { client: true, kickoff: true, projectManager: true },
  });
  const onboarding =
    existingUncertain ??
    (await prisma.onboarding.findFirst({
      where: {
        status: "KICKOFF_PENDING",
        client: { companyName: { startsWith: "Phase 5 Smoke " } },
        kickoff: { is: { status: "PENDING" } },
      },
      orderBy: { createdAt: "asc" },
      include: { client: true, kickoff: true, projectManager: true },
    }));
  const atlasBefore = await prisma.onboarding.findFirst({
    where: { client: { companyName: "Atlas Fitness Studio" } },
    select: { status: true, completedAt: true, version: true },
  });
  invariant(
    onboarding?.client && onboarding.kickoff && onboarding.projectManager?.isActive,
    "Safe Phase 6 uncertain-delivery fixture is missing",
  );
  invariant(
    onboarding.client.contactEmail.endsWith(".test"),
    "Uncertain-delivery recipient is not a test address",
  );

  const recipient = onboarding.client.contactEmail;
  const messagesBefore = await mailpitRecipientCount(recipient);
  let mailpitStopped = false;
  let notificationId = existingUncertain?.kickoff
    ? ((
        await prisma.notificationLog.findFirst({
          where: {
            kickoffId: existingUncertain.kickoff.id,
            notificationType: "KICKOFF_INVITATION",
            status: "DELIVERY_UNCERTAIN",
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      )?.id ?? null)
    : null;

  try {
    if (!notificationId) {
      dockerCompose("stop", "mailpit");
      mailpitStopped = true;

      const startsAt = new Date(Date.now() + 24 * 60 * 60_000);
      const scheduled = await scheduleKickoff({
        actorId: onboarding.projectManager.id,
        onboardingId: onboarding.id,
        expectedKickoffVersion: onboarding.kickoff.version,
        idempotencyKey: `PHASE6-UNCERTAIN-SCHEDULE:${randomUUID()}`,
        localDate: startsAt.toISOString().slice(0, 10),
        localTime: startsAt.toISOString().slice(11, 19),
        timezone: "UTC",
        meetingUrl: "https://meet.northstar.test/phase6-uncertain",
        meetingLocation: null,
        reason: "Verify fail-closed SMTP uncertainty handling.",
        correlationId: randomUUID(),
      });
      invariant(
        scheduled.ok,
        `Uncertain-delivery scheduling failed: ${scheduled.ok ? "" : scheduled.error.code}`,
      );
      notificationId = scheduled.value.notificationId;

      await waitFor(
        () =>
          prisma.notificationLog.findFirst({
            where: { id: notificationId!, status: "DELIVERY_UNCERTAIN" },
          }),
        "Phase 6 uncertain notification state",
      );
    }
  } finally {
    if (mailpitStopped) {
      dockerCompose("start", "mailpit");
      await waitForMailpit();
    }
  }

  invariant(notificationId, "Uncertain-delivery notification was not created");
  const [notification, event, latestRun, current, atlasAfter, messagesAfter] = await Promise.all([
    prisma.notificationLog.findUniqueOrThrow({ where: { id: notificationId } }),
    prisma.automationEvent.findFirstOrThrow({
      where: {
        aggregateId: onboarding.id,
        eventType: "KICKOFF_INVITATION_REQUESTED",
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.automationRun.findFirst({
      where: {
        automationEvent: {
          aggregateId: onboarding.id,
          eventType: "KICKOFF_INVITATION_REQUESTED",
        },
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
      include: { kickoff: true, deliveryHandoff: true },
    }),
    prisma.onboarding.findFirst({
      where: { client: { companyName: "Atlas Fitness Studio" } },
      select: { status: true, completedAt: true, version: true },
    }),
    mailpitRecipientCount(recipient),
  ]);

  invariant(notification.status === "DELIVERY_UNCERTAIN", "Notification did not fail closed");
  invariant(!notification.sentAt && !notification.providerReference, "Uncertain email was sent");
  invariant(
    event.status === "FAILED" && event.lastErrorCode === "EMAIL_DELIVERY_UNCERTAIN",
    "Automation event did not preserve operator-remediable uncertainty",
  );
  invariant(
    latestRun?.status === "FAILED" &&
      latestRun.errorCode === "EMAIL_DELIVERY_UNCERTAIN" &&
      latestRun.failureClassification === "OPERATOR_REMEDIABLE",
    "Automation run did not preserve uncertainty details",
  );
  invariant(
    current.status === "KICKOFF_PENDING" &&
      current.kickoff?.status === "SCHEDULED" &&
      !current.deliveryHandoff,
    "Uncertain invitation advanced the Phase 6 lifecycle",
  );
  invariant(messagesAfter === messagesBefore, "Mailpit received the uncertain invitation");
  invariant(
    JSON.stringify(atlasAfter) === JSON.stringify(atlasBefore),
    "Atlas was modified by the uncertain-delivery smoke",
  );

  console.log(
    JSON.stringify(
      {
        onboardingId: onboarding.id,
        notificationId,
        notificationStatus: notification.status,
        eventStatus: event.status,
        runStatus: latestRun.status,
        lifecycleStatus: current.status,
        kickoffStatus: current.kickoff.status,
        mailpitMessageDelta: messagesAfter - messagesBefore,
        atlasUnchanged: true,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}

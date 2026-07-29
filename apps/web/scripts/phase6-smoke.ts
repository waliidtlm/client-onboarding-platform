import "dotenv/config";

import { randomUUID } from "node:crypto";

import {
  acknowledgeDeliveryHandoff,
  markDeliveryHandoffReady,
  saveDeliveryHandoffDraft,
} from "@/application/phase6/handoff-service";
import { completeKickoff, scheduleKickoff } from "@/application/phase6/kickoff-service";
import { prisma } from "@/lib/database";

const mailpitApi = "http://127.0.0.1:8025/api/v1";

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function waitFor<T>(
  work: () => Promise<T | null>,
  label: string,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await work();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function mailpitMessages() {
  return fetch(`${mailpitApi}/messages`).then(
    (response) =>
      response.json() as Promise<{
        messages?: Array<{
          ID: string;
          To?: Array<{ Address?: string }>;
          Subject?: string;
        }>;
      }>,
  );
}

async function main() {
  const onboarding = await prisma.onboarding.findFirst({
    where: {
      status: "KICKOFF_PENDING",
      client: { companyName: { startsWith: "Phase 5 Smoke " } },
      kickoff: { is: { status: "PENDING" } },
    },
    orderBy: { createdAt: "asc" },
    include: { client: true, kickoff: true, projectManager: true },
  });
  const [admin, delivery] = await Promise.all([
    prisma.user.findUnique({ where: { email: "admin@northstar.test" } }),
    prisma.user.findFirst({
      where: { role: "DELIVERY", isActive: true },
      orderBy: { email: "asc" },
    }),
  ]);
  invariant(
    onboarding?.client &&
      onboarding.kickoff &&
      onboarding.projectManager?.isActive &&
      admin?.isActive &&
      delivery,
    "Safe Phase 6 smoke prerequisites are missing",
  );
  invariant(
    onboarding.client.contactEmail.endsWith(".test"),
    "Client recipient is not a test address",
  );
  invariant(delivery.email.endsWith(".test"), "Delivery recipient is not a test address");

  const startsAt = new Date(Date.now() + 24 * 60 * 60_000);
  const schedule = await scheduleKickoff({
    actorId: onboarding.projectManager.id,
    onboardingId: onboarding.id,
    expectedKickoffVersion: onboarding.kickoff.version,
    idempotencyKey: `PHASE6-SMOKE-SCHEDULE:${randomUUID()}`,
    localDate: startsAt.toISOString().slice(0, 10),
    localTime: startsAt.toISOString().slice(11, 19),
    timezone: "UTC",
    meetingUrl: "https://meet.northstar.test/phase6-smoke",
    meetingLocation: null,
    reason: null,
    correlationId: randomUUID(),
  });
  invariant(schedule.ok, `Kickoff scheduling failed: ${schedule.ok ? "" : schedule.error.code}`);

  const invitation = await waitFor(
    () =>
      prisma.notificationLog.findFirst({
        where: {
          id: schedule.value.notificationId,
          status: "SENT",
        },
      }),
    "n8n kickoff invitation delivery",
  );
  const scheduledKickoff = await prisma.kickoff.findUniqueOrThrow({
    where: { onboardingId: onboarding.id },
  });
  const completion = await completeKickoff({
    actorId: admin.id,
    onboardingId: onboarding.id,
    expectedKickoffVersion: scheduledKickoff.version,
    idempotencyKey: `PHASE6-SMOKE-COMPLETE:${randomUUID()}`,
    outcomeNotes:
      "The Phase 6 smoke kickoff confirmed project scope, ownership, milestones, communication, and immediate next actions.",
    timingOverrideReason:
      "Local smoke verification intentionally completes the kickoff before its future test schedule.",
    correlationId: randomUUID(),
  });
  invariant(
    completion.ok,
    `Kickoff completion failed: ${completion.ok ? "" : completion.error.code}`,
  );

  const handoff = await prisma.deliveryHandoff.findUniqueOrThrow({
    where: { onboardingId: onboarding.id },
  });
  const saved = await saveDeliveryHandoffDraft({
    actorId: onboarding.projectManager.id,
    onboardingId: onboarding.id,
    expectedHandoffVersion: handoff.version,
    assignedDeliveryId: delivery.id,
    summary:
      "Delivery owns the approved Phase 5 inputs and the decisions captured during the verified kickoff.",
    riskNotes: "No blocking delivery risk was identified during the smoke kickoff.",
    nextActions: "Review the frozen source, acknowledge ownership, and begin delivery planning.",
    correlationId: randomUUID(),
  });
  invariant(saved.ok, `Handoff draft save failed: ${saved.ok ? "" : saved.error.code}`);
  const savedHandoff = await prisma.deliveryHandoff.findUniqueOrThrow({
    where: { onboardingId: onboarding.id },
  });
  const ready = await markDeliveryHandoffReady({
    actorId: onboarding.projectManager.id,
    onboardingId: onboarding.id,
    expectedHandoffVersion: savedHandoff.version,
    idempotencyKey: `PHASE6-SMOKE-READY:${randomUUID()}`,
    correlationId: randomUUID(),
  });
  invariant(ready.ok, `Handoff ready failed: ${ready.ok ? "" : ready.error.code}`);
  const notifiedHandoff = await waitFor(
    () =>
      prisma.deliveryHandoff.findFirst({
        where: { onboardingId: onboarding.id, status: "NOTIFIED" },
      }),
    "n8n Delivery notification",
  );
  const currentOnboarding = await prisma.onboarding.findUniqueOrThrow({
    where: { id: onboarding.id },
  });
  const acknowledged = await acknowledgeDeliveryHandoff({
    actorId: delivery.id,
    onboardingId: onboarding.id,
    expectedHandoffVersion: notifiedHandoff.version,
    expectedOnboardingVersion: currentOnboarding.version,
    idempotencyKey: `PHASE6-SMOKE-ACK:${randomUUID()}`,
    adminExceptionReason: null,
    correlationId: randomUUID(),
  });
  invariant(
    acknowledged.ok,
    `Handoff acknowledgment failed: ${acknowledged.ok ? "" : acknowledged.error.code}`,
  );

  const [completed, atlas, inbox] = await Promise.all([
    prisma.onboarding.findUniqueOrThrow({
      where: { id: onboarding.id },
      include: {
        kickoff: true,
        deliveryHandoff: true,
        clientAccessTokens: true,
      },
    }),
    prisma.onboarding.findFirst({
      where: { client: { companyName: "Atlas Fitness Studio" } },
      select: { status: true, completedAt: true },
    }),
    mailpitMessages(),
  ]);
  const kickoffMessages =
    inbox.messages?.filter((message) =>
      message.To?.some((recipient) => recipient.Address === onboarding.client!.contactEmail),
    ) ?? [];
  const handoffMessages =
    inbox.messages?.filter(
      (message) =>
        message.To?.some((recipient) => recipient.Address === delivery.email) &&
        message.Subject?.includes(onboarding.client!.companyName),
    ) ?? [];
  invariant(completed.status === "COMPLETED", "Onboarding did not reach COMPLETED");
  invariant(
    completed.slaResult === "NOT_CONFIGURED",
    "Legacy smoke fixture must remain NOT_CONFIGURED",
  );
  invariant(completed.kickoff?.status === "COMPLETED", "Kickoff is not complete");
  invariant(completed.deliveryHandoff?.status === "ACKNOWLEDGED", "Handoff is not acknowledged");
  invariant(
    completed.clientAccessTokens.every((token) => token.revokedAt),
    "Active client access survived terminal completion",
  );
  invariant(invitation.providerReference, "Invitation provider reference is missing");
  invariant(kickoffMessages.length === 1, "Mailpit does not contain exactly one client invitation");
  invariant(
    handoffMessages.length === 1,
    "Mailpit does not contain exactly one Delivery handoff message",
  );
  invariant(atlas?.status === "COMMERCIAL_PENDING" && !atlas.completedAt, "Atlas was modified");

  console.log(
    JSON.stringify(
      {
        onboardingId: completed.id,
        clientRecipient: onboarding.client.contactEmail,
        deliveryRecipient: delivery.email,
        onboardingStatus: completed.status,
        kickoffStatus: completed.kickoff.status,
        handoffStatus: completed.deliveryHandoff.status,
        slaResult: completed.slaResult,
        mailpitClientMessages: kickoffMessages.length,
        mailpitDeliveryMessages: handoffMessages.length,
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

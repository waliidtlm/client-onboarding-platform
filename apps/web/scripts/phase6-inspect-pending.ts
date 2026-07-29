import "dotenv/config";

import { prisma } from "@/lib/database";

const events = await prisma.automationEvent.findMany({
  where: {
    eventType: "CLIENT_REQUIREMENTS_COMPLETED",
    ...(process.argv.includes("--all") ? {} : { status: "PENDING" }),
  },
  orderBy: { occurredAt: "asc" },
  select: {
    id: true,
    aggregateId: true,
    status: true,
    attemptCount: true,
    onboarding: {
      select: {
        status: true,
        client: { select: { companyName: true, contactEmail: true } },
        kickoff: { select: { id: true, status: true, version: true } },
      },
    },
    runs: {
      orderBy: { attemptNumber: "desc" },
      take: 1,
      select: { id: true, status: true, workerId: true, attemptNumber: true },
    },
  },
});

console.log(
  JSON.stringify(
    events.map((event) => ({
      eventId: event.id,
      onboardingId: event.aggregateId,
      eventStatus: event.status,
      attemptCount: event.attemptCount,
      onboardingStatus: event.onboarding.status,
      companyName: event.onboarding.client?.companyName ?? null,
      recipient: event.onboarding.client?.contactEmail ?? null,
      isTestRecipient: event.onboarding.client?.contactEmail.endsWith(".test") ?? false,
      kickoff: event.onboarding.kickoff,
      latestRun: event.runs[0] ?? null,
    })),
    null,
    2,
  ),
);

await prisma.$disconnect();

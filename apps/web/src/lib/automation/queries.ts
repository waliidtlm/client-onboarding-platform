import { prisma } from "@/lib/database";

export async function listAutomationEventsForRecovery() {
  const events = await prisma.automationEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      onboarding: {
        include: {
          client: { select: { companyName: true } },
        },
      },
      runs: {
        orderBy: { attemptNumber: "desc" },
      },
    },
  });
  return events.map((event) => ({
    id: event.id,
    eventType: event.eventType,
    status: event.status,
    onboardingId: event.aggregateId,
    clientCompanyName: event.onboarding.client?.companyName ?? "Unknown client",
    attemptCount: event.attemptCount,
    maxAttempts: event.maxAttempts,
    availableAt: event.availableAt.toISOString(),
    leaseExpiresAt: event.leaseExpiresAt?.toISOString() ?? null,
    lastErrorCode: event.lastErrorCode,
    lastError: event.lastError,
    createdAt: event.createdAt.toISOString(),
    canRetry: event.status === "FAILED" || event.status === "DEAD_LETTER",
    runs: event.runs.map((run) => ({
      id: run.id,
      attemptNumber: run.attemptNumber,
      workerId: run.workerId,
      status: run.status,
      n8nExecutionId: run.n8nExecutionId,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
    })),
  }));
}

import { AutomationEventStatus, AutomationRunStatus, Prisma } from "@/generated/prisma/client";
import type { TransactionClient } from "@/application/commercial/service-support";
import { reject } from "@/application/commercial/service-support";
import {
  automationEventPayloadIsValid,
  isSupportedAutomationEnvelope,
  type SupportedAutomationEventType,
} from "@/domain/automation/idempotency";

export type BoundAutomationRun = Awaited<ReturnType<typeof requireCurrentAutomationRun>>;

export async function requireCurrentAutomationRun(
  tx: TransactionClient,
  input: Readonly<{
    eventId: string;
    runId: string;
    idempotencyKey: string;
    workerId: string;
    expectedEventType: SupportedAutomationEventType;
  }>,
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id" FROM "AutomationEvent"
    WHERE "id" = ${input.eventId}::uuid
    FOR UPDATE
  `);
  const [event, run, clock] = await Promise.all([
    tx.automationEvent.findUnique({ where: { id: input.eventId } }),
    tx.automationRun.findUnique({ where: { id: input.runId } }),
    tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`),
  ]);
  if (!event || !run || run.automationEventId !== event.id) {
    reject("NOT_FOUND", "The automation event or run does not exist.");
  }
  if (
    !isSupportedAutomationEnvelope(event) ||
    !automationEventPayloadIsValid(event.eventType, event.payload) ||
    event.eventType !== input.expectedEventType
  ) {
    reject("EVENT_BINDING_CONFLICT", "The event does not match the requested operation.");
  }
  if (
    event.status !== AutomationEventStatus.PROCESSING ||
    run.status !== AutomationRunStatus.PROCESSING ||
    event.currentRunId !== run.id ||
    event.claimedBy !== input.workerId ||
    run.workerId !== input.workerId ||
    run.idempotencyKey !== input.idempotencyKey
  ) {
    reject("EVENT_BINDING_CONFLICT", "The request does not match the current automation run.");
  }
  const now = clock[0]!.now;
  if (!event.leaseExpiresAt || event.leaseExpiresAt <= now) {
    reject("LEASE_EXPIRED", "The automation lease has expired.");
  }
  return { event, run, now, payload: event.payload as Record<string, string> };
}

export async function completeBoundAutomationRun(
  tx: TransactionClient,
  binding: BoundAutomationRun,
  input: Readonly<{
    n8nExecutionId: string;
    resultReferences?: Prisma.InputJsonObject;
  }>,
): Promise<void> {
  await tx.automationRun.update({
    where: { id: binding.run.id },
    data: {
      status: AutomationRunStatus.COMPLETED,
      completedAt: binding.now,
      n8nExecutionId: input.n8nExecutionId,
      resultReferences: input.resultReferences ?? {},
    },
  });
  await tx.automationEvent.update({
    where: { id: binding.event.id },
    data: {
      status: AutomationEventStatus.COMPLETED,
      processedAt: binding.now,
      currentRunId: null,
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastError: null,
    },
  });
}

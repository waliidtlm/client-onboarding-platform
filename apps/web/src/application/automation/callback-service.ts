import {
  AutomationEventStatus,
  AutomationRunStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";

import { automationCallbackSchema } from "@/application/automation/contracts";
import type { AutomationCompletionResult } from "@/application/automation/types";
import { executeService, parseInput, reject } from "@/application/commercial/service-support";
import { normalizedJsonEqual } from "@/domain/automation/idempotency";
import type { Result } from "@/domain/errors";

export async function completeAutomationRun(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<AutomationCompletionResult>> {
  return executeService(async () => {
    const input = parseInput(automationCallbackSchema.safeParse(rawInput));
    return database.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "AutomationEvent"
        WHERE "id" = ${input.eventId}::uuid
        FOR UPDATE
      `);
      const [event, run, time] = await Promise.all([
        tx.automationEvent.findUnique({ where: { id: input.eventId } }),
        tx.automationRun.findUnique({ where: { id: input.runId } }),
        tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`),
      ]);
      if (!event || !run || run.automationEventId !== event.id) {
        reject("NOT_FOUND", "The automation event or run does not exist.");
      }
      const normalizedReferences = input.externalReferences;
      if (run.status === AutomationRunStatus.COMPLETED) {
        if (
          event.status === AutomationEventStatus.COMPLETED &&
          run.idempotencyKey === input.idempotencyKey &&
          run.workerId === input.workerId &&
          run.n8nExecutionId === input.n8nExecutionId &&
          normalizedJsonEqual(run.resultReferences ?? {}, normalizedReferences)
        ) {
          return {
            eventId: event.id,
            runId: run.id,
            status: event.status,
            idempotent: true,
          };
        }
        reject("AUTOMATION_RUN_CONFLICT", "The callback conflicts with the completed result.");
      }
      if (
        event.status !== AutomationEventStatus.PROCESSING ||
        run.status !== AutomationRunStatus.PROCESSING ||
        event.currentRunId !== run.id ||
        event.claimedBy !== input.workerId ||
        run.workerId !== input.workerId ||
        run.idempotencyKey !== input.idempotencyKey
      ) {
        reject("AUTOMATION_RUN_CONFLICT", "The callback does not match the current run.");
      }
      const now = time[0]!.now;
      if (!event.leaseExpiresAt || event.leaseExpiresAt <= now) {
        reject("LEASE_EXPIRED", "The automation lease has expired.");
      }
      await tx.automationRun.update({
        where: { id: run.id },
        data: {
          status: AutomationRunStatus.COMPLETED,
          completedAt: now,
          n8nExecutionId: input.n8nExecutionId,
          resultReferences: normalizedReferences,
        },
      });
      await tx.automationEvent.update({
        where: { id: event.id },
        data: {
          status: AutomationEventStatus.COMPLETED,
          processedAt: now,
          currentRunId: null,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
        },
      });
      return {
        eventId: event.id,
        runId: run.id,
        status: AutomationEventStatus.COMPLETED,
        idempotent: false,
      };
    });
  });
}

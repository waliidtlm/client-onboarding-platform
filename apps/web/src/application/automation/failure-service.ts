import {
  AutomationEventStatus,
  AutomationFailureClassification,
  AutomationRunStatus,
  NotificationStatus,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/database";

import { automationFailureSchema } from "@/application/automation/contracts";
import type { AutomationCompletionResult } from "@/application/automation/types";
import { executeService, parseInput, reject } from "@/application/commercial/service-support";
import { failureTargetStatus } from "@/domain/automation/event-state";
import { classifyAutomationFailure, retryAvailableAt } from "@/domain/automation/retry-policy";
import type { Result } from "@/domain/errors";
import { sanitizeAutomationError } from "@/lib/automation/error-sanitizer";
import { getServerEnvironment } from "@/lib/env";

export async function failAutomationRun(
  rawInput: unknown,
  database: PrismaClient = prisma,
): Promise<Result<AutomationCompletionResult>> {
  return executeService(async () => {
    const input = parseInput(automationFailureSchema.safeParse(rawInput));
    const environment = getServerEnvironment();
    const classification = classifyAutomationFailure(input.errorCode);
    if (classification !== input.classification) {
      reject("INVALID_INPUT", "The failure classification does not match the error code.");
    }
    const safeMessage = sanitizeAutomationError(input.errorMessage);
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
      if (run.status === AutomationRunStatus.FAILED) {
        const uncertainWelcomeReplay =
          event.eventType === "WELCOME_EMAIL_REQUESTED" &&
          event.status === AutomationEventStatus.FAILED &&
          run.errorCode === "EMAIL_DELIVERY_UNCERTAIN" &&
          run.failureClassification === AutomationFailureClassification.OPERATOR_REMEDIABLE;
        if (
          run.idempotencyKey === input.idempotencyKey &&
          run.workerId === input.workerId &&
          run.n8nExecutionId === input.n8nExecutionId &&
          run.failedNode === input.failedNode &&
          (uncertainWelcomeReplay ||
            (run.errorCode === input.errorCode &&
              run.errorMessage === safeMessage &&
              run.failureClassification === classification))
        ) {
          return {
            eventId: event.id,
            runId: run.id,
            status: event.status,
            idempotent: true,
          };
        }
        reject("AUTOMATION_RUN_CONFLICT", "The failure report conflicts with the stored result.");
      }
      if (
        event.status !== AutomationEventStatus.PROCESSING ||
        run.status !== AutomationRunStatus.PROCESSING ||
        event.currentRunId !== run.id ||
        event.claimedBy !== input.workerId ||
        run.workerId !== input.workerId ||
        run.idempotencyKey !== input.idempotencyKey
      ) {
        reject("AUTOMATION_RUN_CONFLICT", "The failure does not match the current run.");
      }
      const now = time[0]!.now;
      if (!event.leaseExpiresAt || event.leaseExpiresAt <= now) {
        reject("LEASE_EXPIRED", "The automation lease has expired.");
      }
      const payload =
        event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
          ? (event.payload as Record<string, unknown>)
          : {};
      const notification =
        event.eventType === "WELCOME_EMAIL_REQUESTED" && typeof payload.notificationId === "string"
          ? await tx.notificationLog.findUnique({ where: { id: payload.notificationId } })
          : null;
      const uncertainWelcome =
        notification?.onboardingId === event.aggregateId &&
        notification.status === NotificationStatus.SENDING;
      const recordedClassification = uncertainWelcome
        ? AutomationFailureClassification.OPERATOR_REMEDIABLE
        : classification;
      const recordedErrorCode = uncertainWelcome ? "EMAIL_DELIVERY_UNCERTAIN" : input.errorCode;
      const recordedMessage = uncertainWelcome
        ? "The workflow failed after email delivery began; delivery requires administrator verification."
        : safeMessage;
      const targetStatus = uncertainWelcome
        ? AutomationEventStatus.FAILED
        : failureTargetStatus({
            classification,
            attemptCount: event.attemptCount,
            maxAttempts: event.maxAttempts,
          });
      const availableAt =
        targetStatus === AutomationEventStatus.PENDING
          ? retryAvailableAt(now, event.attemptCount, environment.AUTOMATION_RETRY_BASE_SECONDS)
          : event.availableAt;
      await tx.automationRun.update({
        where: { id: run.id },
        data: {
          status: AutomationRunStatus.FAILED,
          completedAt: now,
          n8nExecutionId: input.n8nExecutionId,
          errorCode: recordedErrorCode,
          errorMessage: recordedMessage,
          failedNode: input.failedNode,
          failureClassification: recordedClassification,
          failureReportedAt: now,
        },
      });
      if (uncertainWelcome && notification) {
        await tx.notificationLog.update({
          where: { id: notification.id },
          data: {
            status: NotificationStatus.DELIVERY_UNCERTAIN,
            failureReason: recordedMessage,
          },
        });
      }
      await tx.automationEvent.update({
        where: { id: event.id },
        data: {
          status: targetStatus,
          availableAt,
          currentRunId: null,
          claimedBy: null,
          claimedAt: null,
          leaseExpiresAt: null,
          lastErrorCode: recordedErrorCode,
          lastError: recordedMessage,
        },
      });
      return {
        eventId: event.id,
        runId: run.id,
        status: targetStatus,
        idempotent: false,
      };
    });
  });
}

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/database";

import { automationContextAccessSchema } from "@/application/automation/contracts";
import type { AutomationContextResult } from "@/application/automation/types";
import { executeService, parseInput, reject } from "@/application/commercial/service-support";
import { canLoadAutomationContext } from "@/domain/automation/event-state";
import { isSupportedAutomationEnvelope } from "@/domain/automation/idempotency";
import { automationEventPayloadIsValid } from "@/domain/automation/idempotency";
import type { Result } from "@/domain/errors";

export async function loadAutomationContext(
  eventId: string,
  rawAccess: unknown,
  database: PrismaClient = prisma,
): Promise<Result<AutomationContextResult>> {
  return executeService(async () => {
    const access = parseInput(automationContextAccessSchema.safeParse(rawAccess));
    return database.$transaction(async (tx) => {
      const time = await tx.$queryRaw<Array<{ now: Date }>>(Prisma.sql`
        SELECT CURRENT_TIMESTAMP AS "now"
      `);
      const event = await tx.automationEvent.findUnique({
        where: { id: eventId },
        include: {
          currentRun: true,
          onboarding: {
            include: {
              client: { select: { companyName: true } },
            },
          },
        },
      });
      if (!event) reject("NOT_FOUND", "The automation event does not exist.");
      const run = event.currentRun;
      if (
        !run ||
        run.id !== access.runId ||
        run.automationEventId !== event.id ||
        run.idempotencyKey !== access.idempotencyKey ||
        run.workerId !== access.workerId
      ) {
        reject("AUTOMATION_CONTEXT_DENIED", "The run is not the current event attempt.");
      }
      if (
        !canLoadAutomationContext({
          eventStatus: event.status,
          runIsCurrent: event.currentRunId === run.id,
          runStatus: run.status,
          leaseExpiresAt: event.leaseExpiresAt,
          now: time[0]!.now,
        })
      ) {
        if (event.leaseExpiresAt && event.leaseExpiresAt <= time[0]!.now) {
          reject("LEASE_EXPIRED", "The automation lease has expired.");
        }
        reject("AUTOMATION_CONTEXT_DENIED", "The event is not actively processing.");
      }
      if (
        !isSupportedAutomationEnvelope(event) ||
        !automationEventPayloadIsValid(event.eventType, event.payload)
      ) {
        if (event.schemaVersion !== 1) {
          reject("INVALID_EVENT_SCHEMA", "The event schema is not supported.");
        }
        reject("UNSUPPORTED_EVENT_TYPE", "The event type is not supported.");
      }
      const onboarding = event.onboarding;
      const payload = event.payload as Record<string, string>;
      const taskId = payload.taskId;
      const notificationId = payload.notificationId;
      const task =
        event.eventType === "PROVISIONING_TASK_REQUESTED" && taskId
          ? await tx.provisioningTask.findUnique({ where: { id: taskId } })
          : null;
      const notification =
        event.eventType === "WELCOME_EMAIL_REQUESTED" && notificationId
          ? await tx.notificationLog.findUnique({ where: { id: notificationId } })
          : null;
      if (
        event.eventType === "ONBOARDING_ACTIVATED" &&
        (onboarding.status !== "READY_FOR_ONBOARDING" || !onboarding.activatedAt)
      ) {
        reject("INVALID_TRANSITION", "The onboarding is not eligible for activation automation.");
      }
      if (
        event.eventType === "PROVISIONING_TASK_REQUESTED" &&
        (!task || task.onboardingId !== onboarding.id)
      ) {
        reject("EVENT_BINDING_CONFLICT", "The task event payload does not match the onboarding.");
      }
      if (
        event.eventType === "WELCOME_EMAIL_REQUESTED" &&
        (!notification || notification.onboardingId !== onboarding.id)
      ) {
        reject("EVENT_BINDING_CONFLICT", "The email event payload does not match the onboarding.");
      }
      if (!onboarding.client?.companyName || !onboarding.servicePackageNameSnapshot) {
        reject("MISSING_BUSINESS_CONFIGURATION", "Required onboarding configuration is missing.");
      }
      return {
        eventId: event.id,
        runId: run.id,
        eventType: event.eventType as
          "ONBOARDING_ACTIVATED" | "PROVISIONING_TASK_REQUESTED" | "WELCOME_EMAIL_REQUESTED",
        schemaVersion: 1 as const,
        correlationId: event.correlationId,
        onboarding: {
          id: onboarding.id,
          status: onboarding.status,
          activatedAt: onboarding.activatedAt?.toISOString() ?? null,
          clientCompanyName: onboarding.client.companyName,
          purchasedPackageName: onboarding.servicePackageNameSnapshot,
          projectManagerId: onboarding.projectManagerId,
          businessVersion: onboarding.version,
        },
        ...(task
          ? {
              task: {
                id: task.id,
                onboardingId: task.onboardingId,
                status: task.status,
                version: task.version,
                attemptCount: task.attemptCount,
                maxAttempts: task.maxAttempts,
                automationKey: task.automationKey,
                idempotencyKey: task.idempotencyKey,
              },
            }
          : {}),
        ...(notification
          ? {
              notification: {
                id: notification.id,
                status: notification.status,
                recipient: notification.recipient,
              },
            }
          : {}),
      };
    });
  });
}

import { prisma } from "@/lib/database";
import type { PrismaClient } from "@/generated/prisma/client";

import { claimAutomationSchema } from "@/application/automation/contracts";
import type { AutomationClaimResult } from "@/application/automation/types";
import { executeService, parseInput, reject } from "@/application/commercial/service-support";
import type { Result } from "@/domain/errors";
import { claimNextAutomationEvent } from "@/infrastructure/automation/prisma-automation-repository";
import { getServerEnvironment } from "@/lib/env";

export async function claimAutomationEvent(
  rawInput: unknown,
  database: PrismaClient = prisma,
  authorizedEventTypes: readonly string[] = [
    "ONBOARDING_ACTIVATED",
    "PROVISIONING_TASK_REQUESTED",
    "WELCOME_EMAIL_REQUESTED",
  ],
): Promise<Result<AutomationClaimResult>> {
  return executeService(async () => {
    const input = parseInput(claimAutomationSchema.safeParse(rawInput));
    const supportedEventTypes = input.supportedEventTypes;
    if (supportedEventTypes.some((eventType) => !authorizedEventTypes.includes(eventType))) {
      reject("ACCESS_DENIED", "The automation identity is not authorized for these event types.");
    }
    const environment = getServerEnvironment();
    const result = await claimNextAutomationEvent(
      database,
      { ...input, supportedEventTypes },
      {
        leaseSeconds: environment.AUTOMATION_LEASE_SECONDS,
        claimReceiptSeconds: 86_400,
      },
    );
    if (result.kind === "CONFLICT") {
      reject("CLAIM_REQUEST_CONFLICT", "The claim request conflicts with an earlier request.");
    }
    if (result.kind === "REJECTED") {
      reject(result.code, "The automation event cannot be processed.");
    }
    return result;
  });
}

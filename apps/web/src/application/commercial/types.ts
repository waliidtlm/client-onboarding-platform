import type { CommercialGateBlocker, CommercialGateStatus } from "@/generated/prisma/client";
import type { AutomationEventEnvelope } from "@/application/automation/types";

export type CommercialMutationResult = Readonly<{
  onboardingId: string;
  version: number;
  status: string;
  commercialGateStatus: CommercialGateStatus;
  blockingReasons: readonly CommercialGateBlocker[];
  activatedAt: string | null;
  idempotent: boolean;
  automationEvent?: AutomationEventEnvelope | null;
  historicalActivation?: boolean;
}>;

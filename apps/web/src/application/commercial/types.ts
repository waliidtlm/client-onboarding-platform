import type { CommercialGateBlocker, CommercialGateStatus } from "@/generated/prisma/client";

export type CommercialMutationResult = Readonly<{
  onboardingId: string;
  version: number;
  status: string;
  commercialGateStatus: CommercialGateStatus;
  blockingReasons: readonly CommercialGateBlocker[];
  activatedAt: string | null;
  idempotent: boolean;
}>;

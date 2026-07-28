import type {
  AutomationEventStatus,
  OnboardingStatus,
  ProvisioningTaskStatus,
} from "@/generated/prisma/client";

export type ProvisioningGenerationResult = Readonly<{
  onboardingId: string;
  status: OnboardingStatus;
  version: number;
  taskIds: readonly string[];
  firstEventId: string;
  idempotent: boolean;
}>;

export type ProvisioningTaskStartResult = Readonly<{
  instruction: "EXECUTE" | "SKIP" | "WAIT" | "MANUAL_REVIEW";
  taskId: string;
  taskStatus: ProvisioningTaskStatus;
  taskVersion: number;
  attemptId?: string;
  attemptNumber?: number;
  idempotencyKey?: string;
}>;

export type ProvisioningTaskResult = Readonly<{
  taskId: string;
  taskStatus: ProvisioningTaskStatus;
  taskVersion: number;
  eventStatus: AutomationEventStatus;
  onboardingStatus: OnboardingStatus;
  nextTaskEventId: string | null;
  idempotent: boolean;
}>;

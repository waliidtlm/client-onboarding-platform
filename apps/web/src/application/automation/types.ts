export type AutomationEventEnvelope = Readonly<{
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  correlationId: string;
  schemaVersion: number;
  payload: Readonly<Record<string, string>>;
}>;

export type AutomationRunClaim = Readonly<{
  runId: string;
  workerId: string;
  workflowName: string;
  idempotencyKey: string;
  attemptNumber: number;
  startedAt: string;
  leaseExpiresAt: string;
}>;

export type AutomationClaimResult =
  | Readonly<{ kind: "EMPTY"; idempotent: boolean }>
  | Readonly<{
      kind: "CLAIMED";
      idempotent: boolean;
      event: AutomationEventEnvelope;
      run: AutomationRunClaim;
    }>;

type AutomationContextBase = Readonly<{
  eventId: string;
  runId: string;
  eventType: "ONBOARDING_ACTIVATED" | "PROVISIONING_TASK_REQUESTED" | "WELCOME_EMAIL_REQUESTED";
  schemaVersion: 1;
  correlationId: string;
}>;

export type AutomationContextResult = AutomationContextBase &
  Readonly<{
    onboarding: Readonly<{
      id: string;
      status: string;
      activatedAt: string | null;
      clientCompanyName: string;
      purchasedPackageName: string;
      projectManagerId: string | null;
      businessVersion: number;
    }>;
    task?: Readonly<{
      id: string;
      onboardingId: string;
      status: string;
      version: number;
      attemptCount: number;
      maxAttempts: number;
      automationKey: string;
      idempotencyKey: string;
    }>;
    notification?: Readonly<{
      id: string;
      status: string;
      recipient: string;
    }>;
  }>;

export type AutomationCompletionResult = Readonly<{
  eventId: string;
  runId: string;
  status: string;
  idempotent: boolean;
}>;

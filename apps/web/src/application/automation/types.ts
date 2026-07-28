export type AutomationEventEnvelope = Readonly<{
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  correlationId: string;
  schemaVersion: number;
  payload: Record<string, never>;
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

export type AutomationContextResult = Readonly<{
  eventId: string;
  runId: string;
  eventType: "ONBOARDING_ACTIVATED";
  schemaVersion: 1;
  correlationId: string;
  onboarding: Readonly<{
    id: string;
    status: string;
    activatedAt: string;
    clientCompanyName: string;
    purchasedPackageName: string;
    projectManagerId: string | null;
    businessVersion: number;
  }>;
}>;

export type AutomationCompletionResult = Readonly<{
  eventId: string;
  runId: string;
  status: string;
  idempotent: boolean;
}>;

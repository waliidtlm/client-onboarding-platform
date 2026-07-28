-- Phase 3: durable automation events, claim leases, execution history, and notification ledger.
-- Existing activated onboardings are intentionally not backfilled.

CREATE TYPE "AutomationEventStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'DEAD_LETTER'
);

CREATE TYPE "AutomationRunStatus" AS ENUM (
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'TIMED_OUT'
);

CREATE TYPE "AutomationFailureClassification" AS ENUM (
  'RETRYABLE',
  'OPERATOR_REMEDIABLE',
  'PERMANENT'
);

CREATE TYPE "AutomationClaimOutcome" AS ENUM (
  'PENDING',
  'CLAIMED',
  'EMPTY',
  'REJECTED'
);

CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "AutomationEvent" (
  "id" UUID NOT NULL,
  "eventType" VARCHAR(100) NOT NULL,
  "aggregateType" VARCHAR(100) NOT NULL,
  "aggregateId" UUID NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "schemaVersion" INTEGER NOT NULL,
  "status" "AutomationEventStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL,
  "availableAt" TIMESTAMPTZ(3) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "processedAt" TIMESTAMPTZ(3),
  "lastErrorCode" VARCHAR(100),
  "lastError" VARCHAR(1000),
  "correlationId" UUID NOT NULL,
  "deduplicationKey" VARCHAR(255) NOT NULL,
  "claimedBy" VARCHAR(100),
  "claimedAt" TIMESTAMPTZ(3),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "currentRunId" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationEvent_attempts_check"
    CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts"),
  CONSTRAINT "AutomationEvent_schema_version_check" CHECK ("schemaVersion" > 0),
  CONSTRAINT "AutomationEvent_lease_check" CHECK (
    (
      "status" = 'PROCESSING'
      AND "claimedBy" IS NOT NULL
      AND "claimedAt" IS NOT NULL
      AND "leaseExpiresAt" IS NOT NULL
      AND "currentRunId" IS NOT NULL
    )
    OR (
      "status" <> 'PROCESSING'
      AND "claimedBy" IS NULL
      AND "claimedAt" IS NULL
      AND "leaseExpiresAt" IS NULL
      AND "currentRunId" IS NULL
    )
  ),
  CONSTRAINT "AutomationEvent_processed_check" CHECK (
    ("status" = 'COMPLETED' AND "processedAt" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "processedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "AutomationEvent_deduplicationKey_key"
  ON "AutomationEvent"("deduplicationKey");
CREATE UNIQUE INDEX "AutomationEvent_currentRunId_key"
  ON "AutomationEvent"("currentRunId");
CREATE INDEX "AutomationEvent_status_availableAt_createdAt_idx"
  ON "AutomationEvent"("status", "availableAt", "createdAt");
CREATE INDEX "AutomationEvent_aggregateType_aggregateId_idx"
  ON "AutomationEvent"("aggregateType", "aggregateId");
CREATE INDEX "AutomationEvent_correlationId_idx"
  ON "AutomationEvent"("correlationId");
CREATE INDEX "AutomationEvent_leaseExpiresAt_idx"
  ON "AutomationEvent"("leaseExpiresAt");

CREATE TABLE "AutomationClaimRequest" (
  "requestId" UUID NOT NULL,
  "workerId" VARCHAR(100) NOT NULL,
  "workflowName" VARCHAR(200) NOT NULL,
  "outcome" "AutomationClaimOutcome" NOT NULL DEFAULT 'PENDING',
  "automationEventId" UUID,
  "errorCode" VARCHAR(100),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationClaimRequest_pkey" PRIMARY KEY ("requestId"),
  CONSTRAINT "AutomationClaimRequest_outcome_check" CHECK (
    ("outcome" = 'PENDING' AND "automationEventId" IS NULL AND "errorCode" IS NULL)
    OR ("outcome" = 'EMPTY' AND "automationEventId" IS NULL AND "errorCode" IS NULL)
    OR ("outcome" = 'CLAIMED' AND "automationEventId" IS NOT NULL AND "errorCode" IS NULL)
    OR ("outcome" = 'REJECTED' AND "errorCode" IS NOT NULL)
  )
);

CREATE INDEX "AutomationClaimRequest_expiresAt_idx"
  ON "AutomationClaimRequest"("expiresAt");

CREATE TABLE "AutomationRun" (
  "id" UUID NOT NULL,
  "automationEventId" UUID NOT NULL,
  "workflowName" VARCHAR(200) NOT NULL,
  "workerId" VARCHAR(100) NOT NULL,
  "n8nExecutionId" VARCHAR(100),
  "claimRequestId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "status" "AutomationRunStatus" NOT NULL DEFAULT 'PROCESSING',
  "attemptNumber" INTEGER NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "errorCode" VARCHAR(100),
  "errorMessage" VARCHAR(1000),
  "failedNode" VARCHAR(200),
  "failureClassification" "AutomationFailureClassification",
  "failureReportedAt" TIMESTAMPTZ(3),
  "resultReferences" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationRun_attempt_check" CHECK ("attemptNumber" > 0),
  CONSTRAINT "AutomationRun_terminal_time_check" CHECK (
    ("status" = 'PROCESSING' AND "completedAt" IS NULL)
    OR ("status" <> 'PROCESSING' AND "completedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "AutomationRun_claimRequestId_key"
  ON "AutomationRun"("claimRequestId");
CREATE UNIQUE INDEX "AutomationRun_idempotencyKey_key"
  ON "AutomationRun"("idempotencyKey");
CREATE UNIQUE INDEX "AutomationRun_automationEventId_attemptNumber_key"
  ON "AutomationRun"("automationEventId", "attemptNumber");
CREATE UNIQUE INDEX "AutomationRun_workerId_n8nExecutionId_key"
  ON "AutomationRun"("workerId", "n8nExecutionId");
CREATE INDEX "AutomationRun_automationEventId_createdAt_idx"
  ON "AutomationRun"("automationEventId", "createdAt");

CREATE TABLE "NotificationLog" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "notificationType" VARCHAR(100) NOT NULL,
  "recipient" VARCHAR(320) NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationStatus" NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "sentAt" TIMESTAMPTZ(3),
  "failureReason" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationLog_idempotencyKey_key"
  ON "NotificationLog"("idempotencyKey");
CREATE INDEX "NotificationLog_onboardingId_createdAt_idx"
  ON "NotificationLog"("onboardingId", "createdAt");

ALTER TABLE "AutomationEvent"
  ADD CONSTRAINT "AutomationEvent_aggregateId_fkey"
  FOREIGN KEY ("aggregateId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomationClaimRequest"
  ADD CONSTRAINT "AutomationClaimRequest_automationEventId_fkey"
  FOREIGN KEY ("automationEventId") REFERENCES "AutomationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomationRun"
  ADD CONSTRAINT "AutomationRun_automationEventId_fkey"
  FOREIGN KEY ("automationEventId") REFERENCES "AutomationEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomationEvent"
  ADD CONSTRAINT "AutomationEvent_currentRunId_fkey"
  FOREIGN KEY ("currentRunId") REFERENCES "AutomationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationLog"
  ADD CONSTRAINT "NotificationLog_onboardingId_fkey"
  FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION protect_automation_run_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AutomationRun records cannot be deleted';
  END IF;

  IF OLD."status" <> 'PROCESSING' THEN
    RAISE EXCEPTION 'Terminal AutomationRun records are immutable';
  END IF;

  IF NEW."status" NOT IN ('COMPLETED', 'FAILED', 'TIMED_OUT') THEN
    RAISE EXCEPTION 'AutomationRun must transition directly to a terminal status';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."automationEventId" IS DISTINCT FROM OLD."automationEventId"
    OR NEW."workflowName" IS DISTINCT FROM OLD."workflowName"
    OR NEW."workerId" IS DISTINCT FROM OLD."workerId"
    OR NEW."claimRequestId" IS DISTINCT FROM OLD."claimRequestId"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."attemptNumber" IS DISTINCT FROM OLD."attemptNumber"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'AutomationRun identity fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "AutomationRun_history_protection"
BEFORE UPDATE OR DELETE ON "AutomationRun"
FOR EACH ROW EXECUTE FUNCTION protect_automation_run_history();

CREATE OR REPLACE FUNCTION prevent_automation_event_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AutomationEvent records cannot be deleted';
END;
$$;

CREATE TRIGGER "AutomationEvent_delete_protection"
BEFORE DELETE ON "AutomationEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_automation_event_delete();

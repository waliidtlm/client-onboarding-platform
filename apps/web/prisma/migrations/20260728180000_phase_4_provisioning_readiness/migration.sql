-- Phase 4: sequential provisioning, internal readiness, sandbox resources, and frozen welcome email delivery.

CREATE TYPE "ProvisioningTaskStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'MANUAL_REVIEW_REQUIRED',
  'MANUALLY_ACCEPTED'
);

CREATE TYPE "ProvisioningTaskAttemptStatus" AS ENUM (
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'TIMED_OUT'
);

ALTER TYPE "NotificationStatus" ADD VALUE 'SENDING';
ALTER TYPE "NotificationStatus" ADD VALUE 'DELIVERY_UNCERTAIN';

ALTER TABLE "Onboarding"
  ADD COLUMN "internalReadinessApprovedById" UUID,
  ADD COLUMN "internalReadinessApprovedAt" TIMESTAMPTZ(3),
  ADD COLUMN "internalReadinessNote" TEXT,
  ADD CONSTRAINT "Onboarding_internal_readiness_approval_check" CHECK (
    (
      "internalReadinessApprovedById" IS NULL
      AND "internalReadinessApprovedAt" IS NULL
      AND "internalReadinessNote" IS NULL
    )
    OR (
      "internalReadinessApprovedById" IS NOT NULL
      AND "internalReadinessApprovedAt" IS NOT NULL
    )
  );

ALTER TABLE "AutomationEvent"
  ADD COLUMN "resolvedById" UUID,
  ADD COLUMN "resolvedAt" TIMESTAMPTZ(3),
  ADD COLUMN "resolutionCode" VARCHAR(100),
  ADD CONSTRAINT "AutomationEvent_manual_resolution_check" CHECK (
    (
      "resolvedById" IS NULL
      AND "resolvedAt" IS NULL
      AND "resolutionCode" IS NULL
    )
    OR (
      "resolvedById" IS NOT NULL
      AND "resolvedAt" IS NOT NULL
      AND "resolutionCode" IS NOT NULL
      AND "status" = 'COMPLETED'
    )
  );

ALTER TABLE "NotificationLog"
  ADD COLUMN "senderKey" VARCHAR(100),
  ADD COLUMN "senderName" VARCHAR(200),
  ADD COLUMN "senderAddress" VARCHAR(320),
  ADD COLUMN "subject" VARCHAR(500),
  ADD COLUMN "textContent" TEXT,
  ADD COLUMN "htmlContent" TEXT,
  ADD COLUMN "templateVersion" INTEGER,
  ADD COLUMN "messageKey" VARCHAR(255),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveryAttemptKey" VARCHAR(255),
  ADD COLUMN "deliveryStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "providerReference" VARCHAR(500),
  ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "NotificationLog"
SET
  "senderKey" = 'LEGACY',
  "senderName" = 'Legacy notification',
  "senderAddress" = 'no-reply@legacy.invalid',
  "subject" = 'Legacy notification',
  "textContent" = 'Legacy notification content was not snapshotted.',
  "templateVersion" = 1,
  "messageKey" = "idempotencyKey";

ALTER TABLE "NotificationLog"
  ALTER COLUMN "senderKey" SET NOT NULL,
  ALTER COLUMN "senderName" SET NOT NULL,
  ALTER COLUMN "senderAddress" SET NOT NULL,
  ALTER COLUMN "subject" SET NOT NULL,
  ALTER COLUMN "textContent" SET NOT NULL,
  ALTER COLUMN "templateVersion" SET NOT NULL,
  ALTER COLUMN "messageKey" SET NOT NULL,
  ADD CONSTRAINT "NotificationLog_attempt_count_check" CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "NotificationLog_template_version_check" CHECK ("templateVersion" > 0),
  ADD CONSTRAINT "NotificationLog_delivery_state_check" CHECK (
    (
      "status" IN ('PENDING', 'FAILED')
      AND "sentAt" IS NULL
    )
    OR (
      "status" IN ('SENDING', 'DELIVERY_UNCERTAIN')
      AND "deliveryAttemptKey" IS NOT NULL
      AND "deliveryStartedAt" IS NOT NULL
      AND "sentAt" IS NULL
    )
    OR (
      "status" = 'SENT'
      AND "deliveryAttemptKey" IS NOT NULL
      AND "deliveryStartedAt" IS NOT NULL
      AND "sentAt" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "NotificationLog_messageKey_key"
  ON "NotificationLog"("messageKey");
CREATE UNIQUE INDEX "NotificationLog_deliveryAttemptKey_key"
  ON "NotificationLog"("deliveryAttemptKey");

CREATE TABLE "ProvisioningTask" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "automationKey" VARCHAR(100) NOT NULL,
  "status" "ProvisioningTaskStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL,
  "lastErrorCode" VARCHAR(100),
  "lastErrorMessage" VARCHAR(1000),
  "externalReference" VARCHAR(500),
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "manuallyAcceptedById" UUID,
  "manuallyAcceptedAt" TIMESTAMPTZ(3),
  "manualAcceptanceReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProvisioningTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProvisioningTask_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "ProvisioningTask_attempts_check"
    CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts"),
  CONSTRAINT "ProvisioningTask_version_check" CHECK ("version" > 0),
  CONSTRAINT "ProvisioningTask_completed_check" CHECK (
    ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "externalReference" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
  ),
  CONSTRAINT "ProvisioningTask_manual_acceptance_check" CHECK (
    (
      "status" = 'MANUALLY_ACCEPTED'
      AND "manuallyAcceptedById" IS NOT NULL
      AND "manuallyAcceptedAt" IS NOT NULL
      AND length(btrim("manualAcceptanceReason")) > 0
    )
    OR (
      "status" <> 'MANUALLY_ACCEPTED'
      AND "manuallyAcceptedById" IS NULL
      AND "manuallyAcceptedAt" IS NULL
      AND "manualAcceptanceReason" IS NULL
    )
  ),
  CONSTRAINT "ProvisioningTask_started_check" CHECK (
    "status" <> 'IN_PROGRESS' OR "startedAt" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "ProvisioningTask_onboardingId_templateId_key"
  ON "ProvisioningTask"("onboardingId", "templateId");
CREATE UNIQUE INDEX "ProvisioningTask_onboardingId_sequence_key"
  ON "ProvisioningTask"("onboardingId", "sequence");
CREATE UNIQUE INDEX "ProvisioningTask_idempotencyKey_key"
  ON "ProvisioningTask"("idempotencyKey");
CREATE INDEX "ProvisioningTask_onboardingId_status_sequence_idx"
  ON "ProvisioningTask"("onboardingId", "status", "sequence");
CREATE UNIQUE INDEX "ProvisioningTask_one_in_progress_per_onboarding_key"
  ON "ProvisioningTask"("onboardingId")
  WHERE "status" = 'IN_PROGRESS';

CREATE TABLE "ProvisioningTaskAttempt" (
  "id" UUID NOT NULL,
  "provisioningTaskId" UUID NOT NULL,
  "automationRunId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "ProvisioningTaskAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "retryable" BOOLEAN,
  "errorCode" VARCHAR(100),
  "errorMessage" VARCHAR(1000),
  "externalReference" VARCHAR(500),
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProvisioningTaskAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProvisioningTaskAttempt_attempt_check" CHECK ("attemptNumber" > 0),
  CONSTRAINT "ProvisioningTaskAttempt_terminal_check" CHECK (
    ("status" = 'IN_PROGRESS' AND "completedAt" IS NULL)
    OR ("status" <> 'IN_PROGRESS' AND "completedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ProvisioningTaskAttempt_automationRunId_key"
  ON "ProvisioningTaskAttempt"("automationRunId");
CREATE UNIQUE INDEX "ProvisioningTaskAttempt_task_attempt_key"
  ON "ProvisioningTaskAttempt"("provisioningTaskId", "attemptNumber");
CREATE INDEX "ProvisioningTaskAttempt_task_created_idx"
  ON "ProvisioningTaskAttempt"("provisioningTaskId", "createdAt");

CREATE TABLE "SandboxProvisionedResource" (
  "id" UUID NOT NULL,
  "provisioningTaskId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "resourceType" VARCHAR(100) NOT NULL,
  "displayName" VARCHAR(300) NOT NULL,
  "externalReference" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SandboxProvisionedResource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SandboxProvisionedResource_provisioningTaskId_key"
  ON "SandboxProvisionedResource"("provisioningTaskId");
CREATE UNIQUE INDEX "SandboxProvisionedResource_idempotencyKey_key"
  ON "SandboxProvisionedResource"("idempotencyKey");
CREATE UNIQUE INDEX "SandboxProvisionedResource_externalReference_key"
  ON "SandboxProvisionedResource"("externalReference");

ALTER TABLE "Onboarding"
  ADD CONSTRAINT "Onboarding_internalReadinessApprovedById_fkey"
  FOREIGN KEY ("internalReadinessApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutomationEvent"
  ADD CONSTRAINT "AutomationEvent_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProvisioningTask"
  ADD CONSTRAINT "ProvisioningTask_onboardingId_fkey"
  FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProvisioningTask_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "PackageProvisioningTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProvisioningTask_manuallyAcceptedById_fkey"
  FOREIGN KEY ("manuallyAcceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProvisioningTaskAttempt"
  ADD CONSTRAINT "ProvisioningTaskAttempt_taskId_fkey"
  FOREIGN KEY ("provisioningTaskId") REFERENCES "ProvisioningTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProvisioningTaskAttempt_runId_fkey"
  FOREIGN KEY ("automationRunId") REFERENCES "AutomationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SandboxProvisionedResource"
  ADD CONSTRAINT "SandboxProvisionedResource_taskId_fkey"
  FOREIGN KEY ("provisioningTaskId") REFERENCES "ProvisioningTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION protect_provisioning_task()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ProvisioningTask records cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."onboardingId" IS DISTINCT FROM OLD."onboardingId"
    OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
    OR NEW."isRequired" IS DISTINCT FROM OLD."isRequired"
    OR NEW."automationKey" IS DISTINCT FROM OLD."automationKey"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'ProvisioningTask identity and snapshot fields are immutable';
  END IF;

  IF OLD."status" IN ('COMPLETED', 'MANUALLY_ACCEPTED')
    AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."externalReference" IS DISTINCT FROM OLD."externalReference"
      OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
      OR NEW."manuallyAcceptedById" IS DISTINCT FROM OLD."manuallyAcceptedById"
      OR NEW."manuallyAcceptedAt" IS DISTINCT FROM OLD."manuallyAcceptedAt"
      OR NEW."manualAcceptanceReason" IS DISTINCT FROM OLD."manualAcceptanceReason"
    )
  THEN
    RAISE EXCEPTION 'Terminal ProvisioningTask results are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProvisioningTask_protection"
BEFORE UPDATE OR DELETE ON "ProvisioningTask"
FOR EACH ROW EXECUTE FUNCTION protect_provisioning_task();

CREATE OR REPLACE FUNCTION protect_provisioning_task_attempt()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ProvisioningTaskAttempt records cannot be deleted';
  END IF;

  IF OLD."status" <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Terminal ProvisioningTaskAttempt records are immutable';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."provisioningTaskId" IS DISTINCT FROM OLD."provisioningTaskId"
    OR NEW."automationRunId" IS DISTINCT FROM OLD."automationRunId"
    OR NEW."attemptNumber" IS DISTINCT FROM OLD."attemptNumber"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'ProvisioningTaskAttempt identity fields are immutable';
  END IF;

  IF NEW."status" NOT IN ('COMPLETED', 'FAILED', 'TIMED_OUT') THEN
    RAISE EXCEPTION 'ProvisioningTaskAttempt must transition directly to a terminal status';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProvisioningTaskAttempt_history_protection"
BEFORE UPDATE OR DELETE ON "ProvisioningTaskAttempt"
FOR EACH ROW EXECUTE FUNCTION protect_provisioning_task_attempt();

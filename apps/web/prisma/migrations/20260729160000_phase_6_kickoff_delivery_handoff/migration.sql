-- Phase 6: kickoff scheduling, delivery handoff, terminal completion, and SLA classification.

CREATE TYPE "KickoffStatus" AS ENUM ('PENDING', 'SCHEDULED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "DeliveryHandoffStatus" AS ENUM ('DRAFT', 'READY', 'NOTIFIED', 'ACKNOWLEDGED', 'CANCELLED');
CREATE TYPE "SlaResult" AS ENUM ('MET', 'MISSED', 'NOT_CONFIGURED');

ALTER TABLE "ServicePackage"
  ADD COLUMN "onboardingSlaTargetHours" INTEGER,
  ADD CONSTRAINT "ServicePackage_sla_target_check"
    CHECK ("onboardingSlaTargetHours" IS NULL OR "onboardingSlaTargetHours" > 0);

ALTER TABLE "Onboarding"
  ADD COLUMN "slaTargetHoursSnapshot" INTEGER,
  ADD COLUMN "slaResult" "SlaResult",
  ADD CONSTRAINT "Onboarding_sla_target_check"
    CHECK ("slaTargetHoursSnapshot" IS NULL OR "slaTargetHoursSnapshot" > 0);

CREATE TABLE "Kickoff" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "status" "KickoffStatus" NOT NULL DEFAULT 'PENDING',
  "scheduledStartAt" TIMESTAMPTZ(3),
  "timezone" VARCHAR(100),
  "meetingUrl" VARCHAR(2048),
  "meetingLocation" VARCHAR(500),
  "scheduleRevision" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMPTZ(3),
  "completedById" UUID,
  "outcomeNotes" TEXT,
  "completionIdempotencyKey" VARCHAR(255),
  "completionFingerprint" CHAR(64),
  "completionTimingOverrideReason" TEXT,
  "invitationWaivedAt" TIMESTAMPTZ(3),
  "invitationWaivedById" UUID,
  "invitationWaiverReason" TEXT,
  "invitationWaivedForRevision" INTEGER,
  "cancelledAt" TIMESTAMPTZ(3),
  "cancelledById" UUID,
  "cancellationReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Kickoff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Kickoff_version_check" CHECK ("version" > 0),
  CONSTRAINT "Kickoff_schedule_revision_check" CHECK ("scheduleRevision" >= 0),
  CONSTRAINT "Kickoff_timezone_length_check"
    CHECK ("timezone" IS NULL OR length("timezone") BETWEEN 1 AND 100),
  CONSTRAINT "Kickoff_url_scheme_check"
    CHECK ("meetingUrl" IS NULL OR "meetingUrl" ~ '^https://'),
  CONSTRAINT "Kickoff_completion_key_check" CHECK (
    num_nonnulls("completionIdempotencyKey", "completionFingerprint") IN (0, 2)
    AND ("completionFingerprint" IS NULL OR "completionFingerprint" ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT "Kickoff_waiver_check" CHECK (
    num_nonnulls(
      "invitationWaivedAt",
      "invitationWaivedById",
      "invitationWaiverReason",
      "invitationWaivedForRevision"
    ) IN (0, 4)
    AND (
      "invitationWaivedForRevision" IS NULL
      OR "invitationWaivedForRevision" BETWEEN 1 AND "scheduleRevision"
    )
  ),
  CONSTRAINT "Kickoff_state_check" CHECK (
    (
      "status" = 'PENDING'
      AND "scheduledStartAt" IS NULL
      AND "timezone" IS NULL
      AND "meetingUrl" IS NULL
      AND "meetingLocation" IS NULL
      AND "completedAt" IS NULL
      AND "completedById" IS NULL
      AND "outcomeNotes" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancelledById" IS NULL
      AND "cancellationReason" IS NULL
    )
    OR
    (
      "status" = 'SCHEDULED'
      AND "scheduledStartAt" IS NOT NULL
      AND "timezone" IS NOT NULL
      AND num_nonnulls("meetingUrl", "meetingLocation") >= 1
      AND "scheduleRevision" > 0
      AND "completedAt" IS NULL
      AND "completedById" IS NULL
      AND "outcomeNotes" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancelledById" IS NULL
      AND "cancellationReason" IS NULL
    )
    OR
    (
      "status" = 'COMPLETED'
      AND "scheduledStartAt" IS NOT NULL
      AND "timezone" IS NOT NULL
      AND num_nonnulls("meetingUrl", "meetingLocation") >= 1
      AND "completedAt" IS NOT NULL
      AND "completedById" IS NOT NULL
      AND length(btrim("outcomeNotes")) BETWEEN 40 AND 5000
      AND "completionIdempotencyKey" IS NOT NULL
      AND "cancelledAt" IS NULL
      AND "cancelledById" IS NULL
      AND "cancellationReason" IS NULL
    )
    OR
    (
      "status" = 'CANCELLED'
      AND "completedAt" IS NULL
      AND "completedById" IS NULL
      AND "outcomeNotes" IS NULL
      AND "cancelledAt" IS NOT NULL
      AND "cancelledById" IS NOT NULL
      AND length(btrim("cancellationReason")) BETWEEN 10 AND 2000
      AND (
        (
          "scheduledStartAt" IS NULL
          AND "timezone" IS NULL
          AND "meetingUrl" IS NULL
          AND "meetingLocation" IS NULL
        )
        OR
        (
          "scheduledStartAt" IS NOT NULL
          AND "timezone" IS NOT NULL
          AND num_nonnulls("meetingUrl", "meetingLocation") >= 1
        )
      )
    )
  )
);

CREATE TABLE "DeliveryHandoff" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "preparedById" UUID,
  "assignedDeliveryUserId" UUID,
  "status" "DeliveryHandoffStatus" NOT NULL DEFAULT 'DRAFT',
  "summary" TEXT,
  "riskNotes" TEXT,
  "nextActions" TEXT,
  "sourceSnapshot" JSONB,
  "sourceFingerprint" CHAR(64),
  "summarySchemaVersion" INTEGER,
  "assignmentRevision" INTEGER NOT NULL DEFAULT 0,
  "preparedAt" TIMESTAMPTZ(3),
  "acknowledgedAt" TIMESTAMPTZ(3),
  "acknowledgedById" UUID,
  "acknowledgmentNotes" TEXT,
  "acknowledgmentIdempotencyKey" VARCHAR(255),
  "acknowledgmentFingerprint" CHAR(64),
  "acknowledgedAsAdminException" BOOLEAN NOT NULL DEFAULT false,
  "acknowledgmentExceptionReason" TEXT,
  "cancelledAt" TIMESTAMPTZ(3),
  "cancellationReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "DeliveryHandoff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryHandoff_version_check" CHECK ("version" > 0),
  CONSTRAINT "DeliveryHandoff_assignment_revision_check" CHECK ("assignmentRevision" >= 0),
  CONSTRAINT "DeliveryHandoff_source_fingerprint_check"
    CHECK ("sourceFingerprint" IS NULL OR "sourceFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DeliveryHandoff_ack_fingerprint_check"
    CHECK ("acknowledgmentFingerprint" IS NULL OR "acknowledgmentFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DeliveryHandoff_state_check" CHECK (
    (
      "status" = 'DRAFT'
      AND "acknowledgedAt" IS NULL
      AND "acknowledgedById" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancellationReason" IS NULL
    )
    OR
    (
      "status" IN ('READY', 'NOTIFIED')
      AND "preparedById" IS NOT NULL
      AND "assignedDeliveryUserId" IS NOT NULL
      AND "preparedAt" IS NOT NULL
      AND length(btrim("summary")) BETWEEN 40 AND 10000
      AND "sourceSnapshot" IS NOT NULL
      AND "sourceFingerprint" IS NOT NULL
      AND "summarySchemaVersion" > 0
      AND "assignmentRevision" > 0
      AND "acknowledgedAt" IS NULL
      AND "acknowledgedById" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancellationReason" IS NULL
    )
    OR
    (
      "status" = 'ACKNOWLEDGED'
      AND "preparedById" IS NOT NULL
      AND "assignedDeliveryUserId" IS NOT NULL
      AND "preparedAt" IS NOT NULL
      AND length(btrim("summary")) BETWEEN 40 AND 10000
      AND "sourceSnapshot" IS NOT NULL
      AND "sourceFingerprint" IS NOT NULL
      AND "summarySchemaVersion" > 0
      AND "acknowledgedAt" IS NOT NULL
      AND "acknowledgedById" IS NOT NULL
      AND "acknowledgmentIdempotencyKey" IS NOT NULL
      AND "acknowledgmentFingerprint" IS NOT NULL
      AND (
        (
          "acknowledgedAsAdminException" = false
          AND "acknowledgmentExceptionReason" IS NULL
        )
        OR
        (
          "acknowledgedAsAdminException" = true
          AND length(btrim("acknowledgmentExceptionReason")) BETWEEN 10 AND 2000
        )
      )
      AND "cancelledAt" IS NULL
      AND "cancellationReason" IS NULL
    )
    OR
    (
      "status" = 'CANCELLED'
      AND "acknowledgedAt" IS NULL
      AND "acknowledgedById" IS NULL
      AND "cancelledAt" IS NOT NULL
      AND length(btrim("cancellationReason")) BETWEEN 10 AND 2000
    )
  )
);

ALTER TABLE "NotificationLog"
  ADD COLUMN "kickoffId" UUID,
  ADD COLUMN "deliveryHandoffId" UUID,
  ADD COLUMN "businessRevision" INTEGER,
  ADD COLUMN "requestFingerprint" CHAR(64),
  ADD CONSTRAINT "NotificationLog_phase6_relation_check" CHECK (
    num_nonnulls("kickoffId", "deliveryHandoffId") <= 1
    AND ("businessRevision" IS NULL OR "businessRevision" > 0)
    AND ("requestFingerprint" IS NULL OR "requestFingerprint" ~ '^[0-9a-f]{64}$')
    AND (
      "notificationType" NOT IN (
        'KICKOFF_INVITATION',
        'DELIVERY_HANDOFF_NOTIFICATION',
        'PHASE6_CANCELLATION'
      )
      OR (
        num_nonnulls("kickoffId", "deliveryHandoffId") = 1
        AND "businessRevision" IS NOT NULL
        AND "requestFingerprint" IS NOT NULL
      )
    )
  );

CREATE UNIQUE INDEX "Kickoff_onboardingId_key" ON "Kickoff"("onboardingId");
CREATE UNIQUE INDEX "Kickoff_completionIdempotencyKey_key"
  ON "Kickoff"("completionIdempotencyKey");
CREATE UNIQUE INDEX "DeliveryHandoff_onboardingId_key"
  ON "DeliveryHandoff"("onboardingId");
CREATE UNIQUE INDEX "DeliveryHandoff_acknowledgmentIdempotencyKey_key"
  ON "DeliveryHandoff"("acknowledgmentIdempotencyKey");
CREATE INDEX "NotificationLog_kickoff_revision_idx"
  ON "NotificationLog"("kickoffId", "businessRevision", "createdAt");
CREATE INDEX "NotificationLog_handoff_revision_idx"
  ON "NotificationLog"("deliveryHandoffId", "businessRevision", "createdAt");
CREATE UNIQUE INDEX "AuditEvent_one_project_ready_per_onboarding_key"
  ON "AuditEvent"("onboardingId")
  WHERE "action" = 'PROJECT_MARKED_READY';
CREATE UNIQUE INDEX "AuditEvent_one_completion_per_onboarding_key"
  ON "AuditEvent"("onboardingId")
  WHERE "action" = 'ONBOARDING_COMPLETED';

ALTER TABLE "Kickoff"
  ADD CONSTRAINT "Kickoff_onboardingId_fkey"
    FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Kickoff_completedById_fkey"
    FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Kickoff_invitationWaivedById_fkey"
    FOREIGN KEY ("invitationWaivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Kickoff_cancelledById_fkey"
    FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeliveryHandoff"
  ADD CONSTRAINT "DeliveryHandoff_onboardingId_fkey"
    FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DeliveryHandoff_preparedById_fkey"
    FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DeliveryHandoff_assignedDeliveryUserId_fkey"
    FOREIGN KEY ("assignedDeliveryUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DeliveryHandoff_acknowledgedById_fkey"
    FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationLog"
  ADD CONSTRAINT "NotificationLog_kickoffId_fkey"
    FOREIGN KEY ("kickoffId") REFERENCES "Kickoff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NotificationLog_deliveryHandoffId_fkey"
    FOREIGN KEY ("deliveryHandoffId") REFERENCES "DeliveryHandoff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION protect_kickoff()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Kickoff records cannot be deleted';
  END IF;
  IF OLD."status" = 'COMPLETED' THEN
    RAISE EXCEPTION 'Completed Kickoff records are immutable';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."onboardingId" IS DISTINCT FROM OLD."onboardingId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Kickoff identity is immutable';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Kickoff optimistic version must increment exactly once';
  END IF;
  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('SCHEDULED', 'CANCELLED'))
    OR (OLD."status" = 'SCHEDULED' AND NEW."status" IN ('SCHEDULED', 'COMPLETED', 'CANCELLED'))
    OR (OLD."status" = 'CANCELLED' AND NEW."status" = 'SCHEDULED')
  ) THEN
    RAISE EXCEPTION 'Invalid Kickoff status transition';
  END IF;
  IF NEW."status" = 'SCHEDULED'
    AND (
      OLD."status" <> 'SCHEDULED'
      OR NEW."scheduledStartAt" IS DISTINCT FROM OLD."scheduledStartAt"
      OR NEW."timezone" IS DISTINCT FROM OLD."timezone"
      OR NEW."meetingUrl" IS DISTINCT FROM OLD."meetingUrl"
      OR NEW."meetingLocation" IS DISTINCT FROM OLD."meetingLocation"
    )
    AND NEW."scheduleRevision" <> OLD."scheduleRevision" + 1
  THEN
    RAISE EXCEPTION 'Scheduling must increment the schedule revision once';
  END IF;
  IF NEW."status" <> 'SCHEDULED'
    AND NEW."scheduleRevision" IS DISTINCT FROM OLD."scheduleRevision"
  THEN
    RAISE EXCEPTION 'Only scheduling may change the schedule revision';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Kickoff_protection"
BEFORE UPDATE OR DELETE ON "Kickoff"
FOR EACH ROW EXECUTE FUNCTION protect_kickoff();

CREATE OR REPLACE FUNCTION protect_delivery_handoff()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  assigned_role "Role";
  assigned_active BOOLEAN;
  acknowledgment_role "Role";
  acknowledgment_active BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'DeliveryHandoff records cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" IN ('ACKNOWLEDGED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Terminal DeliveryHandoff records are immutable';
    END IF;
    IF NEW."id" IS DISTINCT FROM OLD."id"
      OR NEW."onboardingId" IS DISTINCT FROM OLD."onboardingId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    THEN
      RAISE EXCEPTION 'DeliveryHandoff identity is immutable';
    END IF;
    IF NEW."version" <> OLD."version" + 1 THEN
      RAISE EXCEPTION 'DeliveryHandoff optimistic version must increment exactly once';
    END IF;
    IF NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT', 'READY', 'CANCELLED'))
      OR (OLD."status" = 'READY' AND NEW."status" IN ('READY', 'NOTIFIED', 'CANCELLED'))
      OR (OLD."status" = 'NOTIFIED' AND NEW."status" IN ('READY', 'ACKNOWLEDGED', 'CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'Invalid DeliveryHandoff status transition';
    END IF;
    IF OLD."status" IN ('READY', 'NOTIFIED')
      AND (
        NEW."summary" IS DISTINCT FROM OLD."summary"
        OR NEW."riskNotes" IS DISTINCT FROM OLD."riskNotes"
        OR NEW."nextActions" IS DISTINCT FROM OLD."nextActions"
        OR NEW."sourceSnapshot" IS DISTINCT FROM OLD."sourceSnapshot"
        OR NEW."sourceFingerprint" IS DISTINCT FROM OLD."sourceFingerprint"
        OR NEW."summarySchemaVersion" IS DISTINCT FROM OLD."summarySchemaVersion"
        OR NEW."preparedById" IS DISTINCT FROM OLD."preparedById"
        OR NEW."preparedAt" IS DISTINCT FROM OLD."preparedAt"
      )
    THEN
      RAISE EXCEPTION 'Frozen DeliveryHandoff content is immutable';
    END IF;
  END IF;

  IF NEW."status" IN ('READY', 'NOTIFIED', 'ACKNOWLEDGED') THEN
    SELECT "role", "isActive" INTO assigned_role, assigned_active
    FROM "User" WHERE "id" = NEW."assignedDeliveryUserId";
    IF assigned_role IS DISTINCT FROM 'DELIVERY'::"Role" OR assigned_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Active handoff assignment requires an active Delivery user';
    END IF;
  END IF;

  IF NEW."status" = 'ACKNOWLEDGED' THEN
    SELECT "role", "isActive" INTO acknowledgment_role, acknowledgment_active
    FROM "User" WHERE "id" = NEW."acknowledgedById";
    IF acknowledgment_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Acknowledgment actor must be active';
    END IF;
    IF NEW."acknowledgedAsAdminException" THEN
      IF acknowledgment_role IS DISTINCT FROM 'ADMIN'::"Role" THEN
        RAISE EXCEPTION 'Acknowledgment exception actor must be an Admin';
      END IF;
    ELSIF NEW."acknowledgedById" IS DISTINCT FROM NEW."assignedDeliveryUserId"
      OR acknowledgment_role IS DISTINCT FROM 'DELIVERY'::"Role"
    THEN
      RAISE EXCEPTION 'Acknowledgment actor must match the assigned Delivery user';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DeliveryHandoff_protection"
BEFORE INSERT OR UPDATE OR DELETE ON "DeliveryHandoff"
FOR EACH ROW EXECUTE FUNCTION protect_delivery_handoff();

CREATE OR REPLACE FUNCTION protect_phase6_onboarding_milestones()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."requirementsCompletedAt" IS NOT NULL
    AND NEW."requirementsCompletedAt" IS DISTINCT FROM OLD."requirementsCompletedAt"
  THEN
    RAISE EXCEPTION 'Requirements completion timestamp is immutable';
  END IF;
  IF OLD."projectReadyAt" IS NOT NULL
    AND NEW."projectReadyAt" IS DISTINCT FROM OLD."projectReadyAt"
  THEN
    RAISE EXCEPTION 'Project-ready timestamp is immutable';
  END IF;
  IF OLD."completedAt" IS NOT NULL
    AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
  THEN
    RAISE EXCEPTION 'Onboarding completion timestamp is immutable';
  END IF;
  IF OLD."slaTargetHoursSnapshot" IS NOT NULL
    AND NEW."slaTargetHoursSnapshot" IS DISTINCT FROM OLD."slaTargetHoursSnapshot"
  THEN
    RAISE EXCEPTION 'SLA target snapshot is immutable';
  END IF;
  IF OLD."activatedAt" IS NOT NULL
    AND NEW."slaTargetHoursSnapshot" IS DISTINCT FROM OLD."slaTargetHoursSnapshot"
  THEN
    RAISE EXCEPTION 'SLA target cannot be backfilled after activation';
  END IF;
  IF OLD."slaResult" IS NOT NULL AND NEW."slaResult" IS DISTINCT FROM OLD."slaResult" THEN
    RAISE EXCEPTION 'SLA result is immutable';
  END IF;
  IF OLD."status" = 'COMPLETED' THEN
    RAISE EXCEPTION 'Completed onboarding is terminal';
  END IF;
  IF NEW."status" IN ('PROJECT_READY', 'COMPLETED') AND NEW."projectReadyAt" IS NULL THEN
    RAISE EXCEPTION 'Project-ready states require projectReadyAt';
  END IF;
  IF NEW."status" = 'COMPLETED' THEN
    IF NEW."completedAt" IS NULL OR NEW."slaResult" IS NULL THEN
      RAISE EXCEPTION 'Completed onboarding requires completion timestamp and SLA result';
    END IF;
  ELSIF NEW."completedAt" IS NOT NULL OR NEW."slaResult" IS NOT NULL THEN
    RAISE EXCEPTION 'Completion fields require COMPLETED status';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Onboarding_phase6_milestone_protection"
BEFORE UPDATE ON "Onboarding"
FOR EACH ROW EXECUTE FUNCTION protect_phase6_onboarding_milestones();

CREATE OR REPLACE FUNCTION protect_notification_delivery_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."onboardingId" IS DISTINCT FROM OLD."onboardingId"
    OR NEW."notificationType" IS DISTINCT FROM OLD."notificationType"
    OR NEW."recipient" IS DISTINCT FROM OLD."recipient"
    OR NEW."channel" IS DISTINCT FROM OLD."channel"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."senderKey" IS DISTINCT FROM OLD."senderKey"
    OR NEW."senderName" IS DISTINCT FROM OLD."senderName"
    OR NEW."senderAddress" IS DISTINCT FROM OLD."senderAddress"
    OR NEW."subject" IS DISTINCT FROM OLD."subject"
    OR NEW."textContent" IS DISTINCT FROM OLD."textContent"
    OR NEW."htmlContent" IS DISTINCT FROM OLD."htmlContent"
    OR NEW."templateVersion" IS DISTINCT FROM OLD."templateVersion"
    OR NEW."messageKey" IS DISTINCT FROM OLD."messageKey"
    OR NEW."clientAccessTokenId" IS DISTINCT FROM OLD."clientAccessTokenId"
    OR NEW."clientCompanySnapshot" IS DISTINCT FROM OLD."clientCompanySnapshot"
    OR NEW."agencyNameSnapshot" IS DISTINCT FROM OLD."agencyNameSnapshot"
    OR NEW."supportContactSnapshot" IS DISTINCT FROM OLD."supportContactSnapshot"
    OR NEW."publicBaseUrlSnapshot" IS DISTINCT FROM OLD."publicBaseUrlSnapshot"
    OR NEW."fragmentFormatSnapshot" IS DISTINCT FROM OLD."fragmentFormatSnapshot"
    OR NEW."tokenExpiresAtSnapshot" IS DISTINCT FROM OLD."tokenExpiresAtSnapshot"
    OR NEW."tokenSigningKeyVersionSnapshot" IS DISTINCT FROM OLD."tokenSigningKeyVersionSnapshot"
    OR NEW."kickoffId" IS DISTINCT FROM OLD."kickoffId"
    OR NEW."deliveryHandoffId" IS DISTINCT FROM OLD."deliveryHandoffId"
    OR NEW."businessRevision" IS DISTINCT FROM OLD."businessRevision"
    OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Notification delivery snapshot fields are immutable';
  END IF;
  IF OLD."status" = 'SENT'
    AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."providerReference" IS DISTINCT FROM OLD."providerReference"
      OR NEW."sentAt" IS DISTINCT FROM OLD."sentAt"
    )
  THEN
    RAISE EXCEPTION 'Confirmed notification delivery is immutable';
  END IF;
  IF NEW."attemptCount" < OLD."attemptCount" THEN
    RAISE EXCEPTION 'Notification delivery attempt count cannot decrease';
  END IF;
  RETURN NEW;
END;
$$;

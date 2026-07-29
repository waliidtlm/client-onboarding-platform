-- Reconcile databases that applied the pre-existing uncommitted Phase 5 draft
-- before its staff/client audit attribution and due-date rules were corrected.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AuditEvent'
      AND column_name = 'staffActorId'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AuditEvent'
      AND column_name = 'actorId'
  ) THEN
    ALTER TABLE "AuditEvent"
      DROP CONSTRAINT IF EXISTS "AuditEvent_staffActorId_fkey";
    ALTER TABLE "AuditEvent"
      RENAME COLUMN "staffActorId" TO "actorId";
  END IF;
END;
$$;

ALTER TABLE "AuditEvent"
  DROP CONSTRAINT IF EXISTS "AuditEvent_actor_check";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AuditEvent_actorId_fkey'
      AND conrelid = '"AuditEvent"'::regclass
  ) THEN
    ALTER TABLE "AuditEvent"
      ADD CONSTRAINT "AuditEvent_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END;
$$;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_actor_check" CHECK (
    (
      "actorType" = 'STAFF'
      AND "actorId" IS NOT NULL
      AND "clientAccessTokenId" IS NULL
    )
    OR
    (
      "actorType" = 'CLIENT'
      AND "actorId" IS NULL
      AND "clientAccessTokenId" IS NOT NULL
    )
    OR
    (
      "actorType" = 'SYSTEM'
      AND "actorId" IS NULL
      AND "clientAccessTokenId" IS NULL
    )
  );

CREATE OR REPLACE FUNCTION protect_client_access_delivery_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."clientAccessDeliveredAt" IS NOT NULL
    AND NEW."clientAccessDeliveredAt" IS DISTINCT FROM OLD."clientAccessDeliveredAt"
  THEN
    RAISE EXCEPTION 'Client access delivery timestamp is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "Onboarding_client_access_delivery_protection" ON "Onboarding";
CREATE TRIGGER "Onboarding_client_access_delivery_protection"
BEFORE UPDATE ON "Onboarding"
FOR EACH ROW EXECUTE FUNCTION protect_client_access_delivery_timestamp();

CREATE OR REPLACE FUNCTION enforce_client_requirement_due_dates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_onboarding_id UUID;
  delivered_at TIMESTAMPTZ;
BEGIN
  IF TG_TABLE_NAME = 'Onboarding' THEN
    target_onboarding_id := NEW."id";
  ELSE
    target_onboarding_id := NEW."onboardingId";
  END IF;

  SELECT "clientAccessDeliveredAt" INTO delivered_at
  FROM "Onboarding"
  WHERE "id" = target_onboarding_id;

  IF delivered_at IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM "ClientRequirement"
      WHERE "onboardingId" = target_onboarding_id
        AND "dueAt" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Client requirement due dates require confirmed access delivery';
    END IF;
  ELSIF EXISTS (
    SELECT 1
    FROM "ClientRequirement"
    WHERE "onboardingId" = target_onboarding_id
      AND "dueAt" IS DISTINCT FROM
        (delivered_at + ("dueOffsetDays" * INTERVAL '1 day'))
  ) THEN
    RAISE EXCEPTION 'Client requirement due dates must derive from confirmed access delivery';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "ClientRequirement_due_date_check" ON "ClientRequirement";
CREATE CONSTRAINT TRIGGER "ClientRequirement_due_date_check"
AFTER INSERT OR UPDATE ON "ClientRequirement"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_client_requirement_due_dates();

DROP TRIGGER IF EXISTS "Onboarding_client_access_due_date_check" ON "Onboarding";
CREATE CONSTRAINT TRIGGER "Onboarding_client_access_due_date_check"
AFTER INSERT OR UPDATE ON "Onboarding"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_client_requirement_due_dates();

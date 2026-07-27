-- Phase 2: Sales handoff, commercial controls, deterministic gate, activation, and audit.

CREATE TYPE "CommercialGateBlocker" AS ENUM (
  'DEAL_NOT_CLOSED_WON',
  'CONTRACT_NOT_SIGNED',
  'ACTIVATION_AMOUNT_NOT_SATISFIED',
  'PAYMENT_REVIEW_REQUIRED',
  'COMMERCIAL_EXCEPTION_PENDING',
  'ONBOARDING_CANCELLED'
);

CREATE TYPE "SalesHandoffClientMode" AS ENUM ('EXISTING', 'NEW');
CREATE TYPE "CommercialExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');
CREATE TYPE "AuditActorType" AS ENUM ('STAFF', 'SYSTEM');

ALTER TABLE "Invoice"
  DROP CONSTRAINT "Invoice_onboardingId_currency_fkey";

DROP INDEX "Onboarding_id_currency_key";

ALTER TABLE "Onboarding"
  ALTER COLUMN "clientId" DROP NOT NULL,
  ALTER COLUMN "servicePackageId" DROP NOT NULL,
  ALTER COLUMN "dealStatus" DROP NOT NULL,
  ALTER COLUMN "invoiceTotal" DROP NOT NULL,
  ALTER COLUMN "currency" DROP NOT NULL,
  ALTER COLUMN "activationRequiredAmount" DROP NOT NULL,
  ADD COLUMN "commercialGateBlockingReasons" "CommercialGateBlocker"[] NOT NULL DEFAULT ARRAY[]::"CommercialGateBlocker"[],
  ADD COLUMN "commercialGateEvaluatedAt" TIMESTAMPTZ(3),
  ADD COLUMN "servicePackageNameSnapshot" VARCHAR(200),
  ADD COLUMN "activationTypeSnapshot" "ActivationType",
  ADD COLUMN "activationValueSnapshot" DECIMAL(19,4),
  ADD COLUMN "activationInvoiceId" UUID,
  ADD COLUMN "manualActivationApprovedById" UUID,
  ADD COLUMN "manualActivationApprovedAt" TIMESTAMPTZ(3),
  ADD COLUMN "manualActivationRevokedById" UUID,
  ADD COLUMN "manualActivationRevokedAt" TIMESTAMPTZ(3),
  ADD COLUMN "manualActivationRevocationReason" TEXT;

ALTER TABLE "Invoice"
  ALTER COLUMN "invoiceNumber" DROP NOT NULL,
  ALTER COLUMN "dueAt" DROP NOT NULL;

ALTER TABLE "Payment"
  ADD COLUMN "recordingKey" VARCHAR(100),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "Payment"
SET "recordingKey" = 'MIGRATED:' || "id"::text
WHERE "recordingKey" IS NULL;

ALTER TABLE "Payment"
  ALTER COLUMN "recordingKey" SET NOT NULL;

CREATE UNIQUE INDEX "Payment_recordingKey_key" ON "Payment"("recordingKey");
CREATE UNIQUE INDEX "Onboarding_activationInvoiceId_key" ON "Onboarding"("activationInvoiceId");

CREATE TABLE "SalesHandoff" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "submissionKey" VARCHAR(100) NOT NULL,
  "externalDealId" VARCHAR(200),
  "clientMode" "SalesHandoffClientMode",
  "existingClientId" UUID,
  "newClientCompanyName" VARCHAR(200),
  "newClientContactName" VARCHAR(200),
  "newClientContactEmail" VARCHAR(320),
  "newClientContactPhone" VARCHAR(50),
  "servicePackageId" UUID,
  "dealStatus" "DealStatus",
  "agreedTotal" DECIMAL(19,4),
  "currency" CHAR(3),
  "salesNotes" TEXT,
  "validationErrors" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SalesHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesHandoff_onboardingId_key" ON "SalesHandoff"("onboardingId");
CREATE UNIQUE INDEX "SalesHandoff_submissionKey_key" ON "SalesHandoff"("submissionKey");
CREATE UNIQUE INDEX "SalesHandoff_externalDealId_key" ON "SalesHandoff"("externalDealId");
CREATE INDEX "SalesHandoff_servicePackageId_idx" ON "SalesHandoff"("servicePackageId");

CREATE TABLE "CommercialException" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "status" "CommercialExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "reason" TEXT NOT NULL,
  "createdById" UUID NOT NULL,
  "resolvedById" UUID,
  "resolutionNote" TEXT,
  "resolvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CommercialException_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommercialException_onboardingId_status_idx"
  ON "CommercialException"("onboardingId", "status");

CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "actorType" "AuditActorType" NOT NULL,
  "actorId" UUID,
  "action" VARCHAR(100) NOT NULL,
  "entityType" VARCHAR(100) NOT NULL,
  "entityId" VARCHAR(200) NOT NULL,
  "previousValue" JSONB,
  "newValue" JSONB,
  "metadata" JSONB,
  "correlationId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_onboardingId_createdAt_idx"
  ON "AuditEvent"("onboardingId", "createdAt");
CREATE INDEX "AuditEvent_correlationId_idx" ON "AuditEvent"("correlationId");
CREATE UNIQUE INDEX "AuditEvent_one_activation_per_onboarding_key"
  ON "AuditEvent"("onboardingId")
  WHERE "action" = 'ONBOARDING_ACTIVATED';

ALTER TABLE "SalesHandoff"
  ADD CONSTRAINT "SalesHandoff_onboardingId_fkey"
  FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesHandoff_existingClientId_fkey"
  FOREIGN KEY ("existingClientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesHandoff_servicePackageId_fkey"
  FOREIGN KEY ("servicePackageId") REFERENCES "ServicePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_onboardingId_fkey"
  FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Onboarding"
  ADD CONSTRAINT "Onboarding_activationInvoiceId_fkey"
  FOREIGN KEY ("activationInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Onboarding_manualActivationApprovedById_fkey"
  FOREIGN KEY ("manualActivationApprovedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Onboarding_manualActivationRevokedById_fkey"
  FOREIGN KEY ("manualActivationRevokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialException"
  ADD CONSTRAINT "CommercialException_onboardingId_fkey"
  FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommercialException_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CommercialException_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_onboardingId_fkey"
  FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill the authoritative commercial snapshot and designated activation invoice.
UPDATE "Onboarding" AS o
SET
  "servicePackageNameSnapshot" = p."name",
  "activationTypeSnapshot" = p."activationType",
  "activationValueSnapshot" = p."activationValue",
  "commercialGateEvaluatedAt" = o."updatedAt"
FROM "ServicePackage" AS p
WHERE p."id" = o."servicePackageId";

UPDATE "Onboarding" AS o
SET "activationInvoiceId" = chosen."id"
FROM (
  SELECT DISTINCT ON ("onboardingId") "id", "onboardingId"
  FROM "Invoice"
  ORDER BY "onboardingId", "createdAt" DESC
) AS chosen
WHERE chosen."onboardingId" = o."id";

INSERT INTO "SalesHandoff" (
  "id",
  "onboardingId",
  "submissionKey",
  "externalDealId",
  "clientMode",
  "existingClientId",
  "servicePackageId",
  "dealStatus",
  "agreedTotal",
  "currency",
  "validationErrors",
  "version",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  o."id",
  'MIGRATED:' || o."id"::text,
  o."externalDealId",
  'EXISTING',
  o."clientId",
  o."servicePackageId",
  o."dealStatus",
  o."invoiceTotal",
  o."currency",
  NULL,
  1,
  o."createdAt",
  o."updatedAt"
FROM "Onboarding" AS o;

UPDATE "Onboarding" AS o
SET "commercialGateBlockingReasons" = ARRAY(
  SELECT blocker::"CommercialGateBlocker"
  FROM unnest(ARRAY[
    CASE WHEN o."dealStatus" IS DISTINCT FROM 'CLOSED_WON'::"DealStatus"
      THEN 'DEAL_NOT_CLOSED_WON' END,
    CASE WHEN COALESCE((
      SELECT c."status" = 'SIGNED'::"ContractStatus"
      FROM "Contract" AS c
      WHERE c."onboardingId" = o."id"
      ORDER BY c."versionNumber" DESC
      LIMIT 1
    ), false) = false THEN 'CONTRACT_NOT_SIGNED' END,
    CASE WHEN o."activationRequirementStatus" IS DISTINCT FROM 'SATISFIED'::"ActivationRequirementStatus"
      THEN 'ACTIVATION_AMOUNT_NOT_SATISFIED' END,
    CASE WHEN EXISTS (
      SELECT 1
      FROM "Invoice" AS i
      JOIN "Payment" AS p ON p."invoiceId" = i."id"
      WHERE i."onboardingId" = o."id"
        AND p."verificationStatus" = 'REVIEW_REQUIRED'::"PaymentVerificationStatus"
    ) THEN 'PAYMENT_REVIEW_REQUIRED' END,
    CASE WHEN o."status" = 'CANCELLED'::"OnboardingStatus"
      THEN 'ONBOARDING_CANCELLED' END
  ]) AS blocker
  WHERE blocker IS NOT NULL
);

-- A migration baseline is explicit about origin and does not invent historical staff actions.
INSERT INTO "AuditEvent" (
  "id",
  "onboardingId",
  "actorType",
  "actorId",
  "action",
  "entityType",
  "entityId",
  "previousValue",
  "newValue",
  "metadata",
  "correlationId",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  o."id",
  'SYSTEM',
  NULL,
  'PHASE_2_BASELINE_CREATED',
  'ONBOARDING',
  o."id"::text,
  NULL,
  jsonb_build_object(
    'status', o."status"::text,
    'commercialGateStatus', o."commercialGateStatus"::text,
    'version', o."version"
  ),
  jsonb_build_object('source', 'PHASE_1_MIGRATION'),
  md5(o."id"::text || ':phase-2-baseline')::uuid,
  CURRENT_TIMESTAMP
FROM "Onboarding" AS o;

ALTER TABLE "ServicePackage"
  DROP CONSTRAINT "ServicePackage_percentage_range_check",
  ADD CONSTRAINT "ServicePackage_activation_policy_check"
  CHECK (
    ("activationType" = 'FULL_PAYMENT_PERCENTAGE' AND "activationValue" = 100)
    OR ("activationType" = 'DEPOSIT_PERCENTAGE' AND "activationValue" > 0 AND "activationValue" <= 100)
    OR ("activationType" = 'FIXED_DEPOSIT_AMOUNT' AND "activationValue" > 0)
    OR ("activationType" = 'MANUAL_APPROVAL' AND "activationValue" = 0)
  );

ALTER TABLE "Onboarding"
  ADD CONSTRAINT "Onboarding_complete_handoff_authority_check"
  CHECK (
    "salesHandoffStatus" <> 'COMPLETE'
    OR (
      "clientId" IS NOT NULL
      AND "servicePackageId" IS NOT NULL
      AND "externalDealId" IS NOT NULL
      AND "dealStatus" IS NOT NULL
      AND "invoiceTotal" IS NOT NULL
      AND "currency" IS NOT NULL
      AND "servicePackageNameSnapshot" IS NOT NULL
      AND "activationTypeSnapshot" IS NOT NULL
      AND "activationValueSnapshot" IS NOT NULL
      AND (
        "activationTypeSnapshot" = 'MANUAL_APPROVAL'
        OR "activationRequiredAmount" IS NOT NULL
      )
    )
  ),
  ADD CONSTRAINT "Onboarding_activation_snapshot_check"
  CHECK (
    "activationTypeSnapshot" IS NULL
    OR ("activationTypeSnapshot" = 'FULL_PAYMENT_PERCENTAGE' AND "activationValueSnapshot" = 100)
    OR ("activationTypeSnapshot" = 'DEPOSIT_PERCENTAGE' AND "activationValueSnapshot" > 0 AND "activationValueSnapshot" <= 100)
    OR ("activationTypeSnapshot" = 'FIXED_DEPOSIT_AMOUNT' AND "activationValueSnapshot" > 0)
    OR ("activationTypeSnapshot" = 'MANUAL_APPROVAL' AND "activationValueSnapshot" = 0)
  );

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_issued_fields_check"
  CHECK (
    "status" = 'DRAFT'
    OR "status" = 'CANCELLED'
    OR ("invoiceNumber" IS NOT NULL AND "dueAt" IS NOT NULL)
  );

ALTER TABLE "Payment"
  DROP CONSTRAINT "Payment_originalAmount_nonnegative_check",
  DROP CONSTRAINT "Payment_verifiedAmount_nonnegative_check",
  ADD CONSTRAINT "Payment_originalAmount_positive_check" CHECK ("originalAmount" > 0),
  ADD CONSTRAINT "Payment_verifiedAmount_positive_check"
    CHECK ("verifiedAmount" IS NULL OR "verifiedAmount" > 0),
  ADD CONSTRAINT "Payment_version_positive_check" CHECK ("version" > 0);

ALTER TABLE "SalesHandoff"
  ADD CONSTRAINT "SalesHandoff_agreedTotal_positive_check"
    CHECK ("agreedTotal" IS NULL OR "agreedTotal" > 0),
  ADD CONSTRAINT "SalesHandoff_currency_check"
    CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "SalesHandoff_version_positive_check" CHECK ("version" > 0);

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent records are append-only';
END;
$$;

CREATE TRIGGER "AuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onboarding_app_user') THEN
    REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM onboarding_app_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onboarding_test_user') THEN
    REVOKE UPDATE, DELETE ON TABLE "AuditEvent" FROM onboarding_test_user;
  END IF;
END;
$$;

-- Phase 5: scoped client access, immutable requirements and submissions, private file metadata,
-- resumable upload intents, capability-bound automation claims, and public rate limiting.

ALTER TYPE "AuditActorType" ADD VALUE 'CLIENT';

CREATE TYPE "ClientRequirementStatus" AS ENUM (
  'PENDING',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE "RequirementReviewDecision" AS ENUM ('APPROVED', 'REJECTED');

CREATE TYPE "FileUploadIntentStatus" AS ENUM (
  'PENDING',
  'FINALIZING',
  'FINALIZED',
  'REJECTED',
  'EXPIRED'
);

ALTER TABLE "PackageRequirementTemplate"
  ADD CONSTRAINT "PackageRequirementTemplate_sequence_check" CHECK ("sequence" > 0),
  ADD CONSTRAINT "PackageRequirementTemplate_due_offset_check" CHECK ("dueOffsetDays" >= 0);

ALTER TABLE "Onboarding"
  ADD COLUMN "clientAccessDeliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "requirementsGenerationKey" VARCHAR(255),
  ADD COLUMN "requirementsGeneratedAt" TIMESTAMPTZ(3),
  ADD CONSTRAINT "Onboarding_requirement_generation_check" CHECK (
    ("requirementsGenerationKey" IS NULL AND "requirementsGeneratedAt" IS NULL)
    OR
    ("requirementsGenerationKey" IS NOT NULL AND "requirementsGeneratedAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "Onboarding_requirementsGenerationKey_key"
  ON "Onboarding"("requirementsGenerationKey");

ALTER TABLE "AuditEvent"
  DROP CONSTRAINT "AuditEvent_actorId_fkey";
ALTER TABLE "AuditEvent"
  RENAME COLUMN "actorId" TO "staffActorId";

ALTER TABLE "AuditEvent"
  ADD COLUMN "clientAccessTokenId" UUID;

ALTER TABLE "AutomationClaimRequest"
  ADD COLUMN "requestFingerprint" CHAR(64),
  ADD COLUMN "supportedEventTypes" TEXT[];

UPDATE "AutomationClaimRequest"
SET
  "requestFingerprint" = lpad(replace("requestId"::text, '-', ''), 64, '0'),
  "supportedEventTypes" = ARRAY[
    'ONBOARDING_ACTIVATED',
    'PROVISIONING_TASK_REQUESTED',
    'WELCOME_EMAIL_REQUESTED'
  ]::TEXT[];

ALTER TABLE "AutomationClaimRequest"
  ALTER COLUMN "requestFingerprint" SET NOT NULL,
  ALTER COLUMN "supportedEventTypes" SET NOT NULL,
  ADD CONSTRAINT "AutomationClaimRequest_fingerprint_check"
    CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "AutomationClaimRequest_capabilities_check"
    CHECK (
      cardinality("supportedEventTypes") BETWEEN 1 AND 10
      AND array_position("supportedEventTypes", NULL) IS NULL
    );

CREATE TABLE "ClientRequirement" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "inputType" "RequirementInputType" NOT NULL,
  "isRequired" BOOLEAN NOT NULL,
  "sequence" INTEGER NOT NULL,
  "dueOffsetDays" INTEGER NOT NULL,
  "dueAt" TIMESTAMPTZ(3),
  "status" "ClientRequirementStatus" NOT NULL DEFAULT 'PENDING',
  "currentSubmissionVersion" INTEGER NOT NULL DEFAULT 0,
  "reviewingSubmissionVersion" INTEGER,
  "approvedById" UUID,
  "approvedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ClientRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClientRequirement_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "ClientRequirement_due_offset_check" CHECK ("dueOffsetDays" >= 0),
  CONSTRAINT "ClientRequirement_submission_version_check" CHECK ("currentSubmissionVersion" >= 0),
  CONSTRAINT "ClientRequirement_version_check" CHECK ("version" > 0),
  CONSTRAINT "ClientRequirement_reviewing_check" CHECK (
    (
      "status" = 'UNDER_REVIEW'
      AND "reviewingSubmissionVersion" IS NOT NULL
      AND "reviewingSubmissionVersion" = "currentSubmissionVersion"
      AND "currentSubmissionVersion" > 0
    )
    OR
    ("status" <> 'UNDER_REVIEW' AND "reviewingSubmissionVersion" IS NULL)
  ),
  CONSTRAINT "ClientRequirement_approval_check" CHECK (
    (
      "status" = 'APPROVED'
      AND "approvedById" IS NOT NULL
      AND "approvedAt" IS NOT NULL
    )
    OR
    (
      "status" <> 'APPROVED'
      AND "approvedById" IS NULL
      AND "approvedAt" IS NULL
    )
  ),
  CONSTRAINT "ClientRequirement_submission_state_check" CHECK (
    ("status" = 'PENDING' AND "currentSubmissionVersion" = 0)
    OR
    ("status" <> 'PENDING' AND "currentSubmissionVersion" > 0)
  )
);

CREATE UNIQUE INDEX "ClientRequirement_onboardingId_templateId_key"
  ON "ClientRequirement"("onboardingId", "templateId");
CREATE UNIQUE INDEX "ClientRequirement_onboardingId_sequence_key"
  ON "ClientRequirement"("onboardingId", "sequence");
CREATE INDEX "ClientRequirement_onboardingId_status_sequence_idx"
  ON "ClientRequirement"("onboardingId", "status", "sequence");

CREATE TABLE "ClientAccessToken" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "tokenNonce" VARCHAR(43) NOT NULL,
  "tokenVersion" INTEGER NOT NULL,
  "signingKeyVersion" INTEGER NOT NULL,
  "issueSequence" INTEGER NOT NULL,
  "issuanceKey" VARCHAR(255) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "revocationReason" TEXT,
  "replacedById" UUID,
  "lastUsedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientAccessToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClientAccessToken_nonce_check" CHECK ("tokenNonce" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "ClientAccessToken_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ClientAccessToken_fingerprint_check" CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ClientAccessToken_versions_check"
    CHECK ("tokenVersion" > 0 AND "signingKeyVersion" > 0 AND "issueSequence" > 0),
  CONSTRAINT "ClientAccessToken_revocation_check" CHECK (
    ("revokedAt" IS NULL AND "revocationReason" IS NULL AND "replacedById" IS NULL)
    OR
    ("revokedAt" IS NOT NULL AND length(btrim("revocationReason")) > 0)
  )
);

CREATE UNIQUE INDEX "ClientAccessToken_tokenHash_key" ON "ClientAccessToken"("tokenHash");
CREATE UNIQUE INDEX "ClientAccessToken_issuanceKey_key" ON "ClientAccessToken"("issuanceKey");
CREATE UNIQUE INDEX "ClientAccessToken_replacedById_key" ON "ClientAccessToken"("replacedById");
CREATE UNIQUE INDEX "ClientAccessToken_onboardingId_issueSequence_key"
  ON "ClientAccessToken"("onboardingId", "issueSequence");
CREATE UNIQUE INDEX "ClientAccessToken_one_active_per_onboarding_key"
  ON "ClientAccessToken"("onboardingId")
  WHERE "revokedAt" IS NULL;
CREATE INDEX "ClientAccessToken_onboardingId_expiresAt_idx"
  ON "ClientAccessToken"("onboardingId", "expiresAt");

CREATE TABLE "RequirementSubmission" (
  "id" UUID NOT NULL,
  "requirementId" UUID NOT NULL,
  "submissionVersion" INTEGER NOT NULL,
  "textValue" TEXT,
  "urlValue" VARCHAR(2048),
  "submittedViaTokenId" UUID NOT NULL,
  "submissionIdempotencyKey" VARCHAR(255) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL,
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedById" UUID,
  "reviewDecision" "RequirementReviewDecision",
  "reviewReason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequirementSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RequirementSubmission_version_check" CHECK ("submissionVersion" > 0),
  CONSTRAINT "RequirementSubmission_fingerprint_check" CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "RequirementSubmission_content_check"
    CHECK (num_nonnulls("textValue", "urlValue") <= 1),
  CONSTRAINT "RequirementSubmission_review_check" CHECK (
    (
      "reviewDecision" IS NULL
      AND "reviewedAt" IS NULL
      AND "reviewedById" IS NULL
      AND "reviewReason" IS NULL
    )
    OR
    (
      "reviewDecision" = 'APPROVED'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
      AND "reviewReason" IS NULL
    )
    OR
    (
      "reviewDecision" = 'REJECTED'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
      AND length(btrim("reviewReason")) >= 10
    )
  )
);

CREATE UNIQUE INDEX "RequirementSubmission_requirementId_submissionVersion_key"
  ON "RequirementSubmission"("requirementId", "submissionVersion");
CREATE UNIQUE INDEX "RequirementSubmission_requirementId_submissionIdempotencyKey_key"
  ON "RequirementSubmission"("requirementId", "submissionIdempotencyKey");
CREATE INDEX "RequirementSubmission_requirementId_createdAt_idx"
  ON "RequirementSubmission"("requirementId", "createdAt");

CREATE TABLE "FileUploadIntent" (
  "id" UUID NOT NULL,
  "clientAccessTokenId" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "requirementId" UUID NOT NULL,
  "expectedInputType" "RequirementInputType" NOT NULL,
  "uploadStorageKey" VARCHAR(500) NOT NULL,
  "finalStorageKey" VARCHAR(500) NOT NULL,
  "originalFilename" VARCHAR(255) NOT NULL,
  "declaredMimeType" VARCHAR(200) NOT NULL,
  "declaredSizeBytes" BIGINT NOT NULL,
  "declaredChecksum" CHAR(64) NOT NULL,
  "status" "FileUploadIntentStatus" NOT NULL DEFAULT 'PENDING',
  "failureCode" VARCHAR(100),
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "finalizedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "FileUploadIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FileUploadIntent_size_check"
    CHECK ("declaredSizeBytes" > 0 AND "declaredSizeBytes" <= 10485760),
  CONSTRAINT "FileUploadIntent_checksum_check" CHECK ("declaredChecksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "FileUploadIntent_fingerprint_check" CHECK ("requestFingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "FileUploadIntent_version_check" CHECK ("version" > 0),
  CONSTRAINT "FileUploadIntent_type_check"
    CHECK ("expectedInputType" IN ('FILE', 'MULTI_FILE')),
  CONSTRAINT "FileUploadIntent_finalized_check" CHECK (
    ("status" = 'FINALIZED' AND "finalizedAt" IS NOT NULL)
    OR
    ("status" <> 'FINALIZED' AND "finalizedAt" IS NULL)
  ),
  CONSTRAINT "FileUploadIntent_failure_check" CHECK (
    ("status" IN ('REJECTED', 'EXPIRED') AND "failureCode" IS NOT NULL)
    OR
    ("status" NOT IN ('REJECTED', 'EXPIRED') AND "failureCode" IS NULL)
  )
);

CREATE UNIQUE INDEX "FileUploadIntent_uploadStorageKey_key"
  ON "FileUploadIntent"("uploadStorageKey");
CREATE UNIQUE INDEX "FileUploadIntent_finalStorageKey_key"
  ON "FileUploadIntent"("finalStorageKey");
CREATE UNIQUE INDEX "FileUploadIntent_token_idempotency_key"
  ON "FileUploadIntent"("clientAccessTokenId", "idempotencyKey");
CREATE INDEX "FileUploadIntent_status_expiresAt_idx"
  ON "FileUploadIntent"("status", "expiresAt");
CREATE INDEX "FileUploadIntent_onboardingId_requirementId_idx"
  ON "FileUploadIntent"("onboardingId", "requirementId");

CREATE TABLE "FileAsset" (
  "id" UUID NOT NULL,
  "onboardingId" UUID NOT NULL,
  "requirementId" UUID NOT NULL,
  "uploadIntentId" UUID NOT NULL,
  "requirementSubmissionId" UUID,
  "storageKey" VARCHAR(500) NOT NULL,
  "originalFilename" VARCHAR(255) NOT NULL,
  "mimeType" VARCHAR(200) NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "displayOrder" INTEGER,
  "uploadedAt" TIMESTAMPTZ(3) NOT NULL,
  "finalizedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FileAsset_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760),
  CONSTRAINT "FileAsset_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "FileAsset_attachment_check" CHECK (
    ("requirementSubmissionId" IS NULL AND "displayOrder" IS NULL)
    OR
    ("requirementSubmissionId" IS NOT NULL AND "displayOrder" IS NOT NULL AND "displayOrder" > 0)
  )
);

CREATE UNIQUE INDEX "FileAsset_uploadIntentId_key" ON "FileAsset"("uploadIntentId");
CREATE UNIQUE INDEX "FileAsset_storageKey_key" ON "FileAsset"("storageKey");
CREATE INDEX "FileAsset_onboardingId_requirementId_idx"
  ON "FileAsset"("onboardingId", "requirementId");
CREATE INDEX "FileAsset_submission_display_idx"
  ON "FileAsset"("requirementSubmissionId", "displayOrder");

CREATE TABLE "PublicRateLimitBucket" (
  "id" UUID NOT NULL,
  "scope" VARCHAR(100) NOT NULL,
  "subjectHash" CHAR(64) NOT NULL,
  "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
  "count" INTEGER NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PublicRateLimitBucket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicRateLimitBucket_count_check" CHECK ("count" > 0),
  CONSTRAINT "PublicRateLimitBucket_subject_check" CHECK ("subjectHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "PublicRateLimitBucket_scope_subject_window_key"
  ON "PublicRateLimitBucket"("scope", "subjectHash", "windowStartedAt");
CREATE INDEX "PublicRateLimitBucket_expiresAt_idx"
  ON "PublicRateLimitBucket"("expiresAt");

ALTER TABLE "NotificationLog"
  ADD COLUMN "clientAccessTokenId" UUID,
  ADD COLUMN "clientCompanySnapshot" VARCHAR(200),
  ADD COLUMN "agencyNameSnapshot" VARCHAR(200),
  ADD COLUMN "supportContactSnapshot" VARCHAR(320),
  ADD COLUMN "publicBaseUrlSnapshot" VARCHAR(500),
  ADD COLUMN "fragmentFormatSnapshot" VARCHAR(100),
  ADD COLUMN "tokenExpiresAtSnapshot" TIMESTAMPTZ(3),
  ADD COLUMN "tokenSigningKeyVersionSnapshot" INTEGER,
  ADD CONSTRAINT "NotificationLog_client_access_snapshot_check" CHECK (
    (
      "notificationType" <> 'CLIENT_ACCESS_EMAIL'
      AND "clientAccessTokenId" IS NULL
      AND "clientCompanySnapshot" IS NULL
      AND "agencyNameSnapshot" IS NULL
      AND "supportContactSnapshot" IS NULL
      AND "publicBaseUrlSnapshot" IS NULL
      AND "fragmentFormatSnapshot" IS NULL
      AND "tokenExpiresAtSnapshot" IS NULL
      AND "tokenSigningKeyVersionSnapshot" IS NULL
    )
    OR
    (
      "notificationType" = 'CLIENT_ACCESS_EMAIL'
      AND "clientAccessTokenId" IS NOT NULL
      AND length(btrim("clientCompanySnapshot")) > 0
      AND length(btrim("agencyNameSnapshot")) > 0
      AND length(btrim("supportContactSnapshot")) > 0
      AND length(btrim("publicBaseUrlSnapshot")) > 0
      AND "fragmentFormatSnapshot" = '#token={token}'
      AND "tokenExpiresAtSnapshot" IS NOT NULL
      AND "tokenSigningKeyVersionSnapshot" > 0
    )
  );

CREATE UNIQUE INDEX "NotificationLog_clientAccessTokenId_key"
  ON "NotificationLog"("clientAccessTokenId");

ALTER TABLE "ClientRequirement"
  ADD CONSTRAINT "ClientRequirement_onboardingId_fkey"
    FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientRequirement_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "PackageRequirementTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientRequirement_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientAccessToken"
  ADD CONSTRAINT "ClientAccessToken_onboardingId_fkey"
    FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientAccessToken_replacedById_fkey"
    FOREIGN KEY ("replacedById") REFERENCES "ClientAccessToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "RequirementSubmission"
  ADD CONSTRAINT "RequirementSubmission_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "ClientRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RequirementSubmission_submittedViaTokenId_fkey"
    FOREIGN KEY ("submittedViaTokenId") REFERENCES "ClientAccessToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RequirementSubmission_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FileUploadIntent"
  ADD CONSTRAINT "FileUploadIntent_clientAccessTokenId_fkey"
    FOREIGN KEY ("clientAccessTokenId") REFERENCES "ClientAccessToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FileUploadIntent_onboardingId_fkey"
    FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FileUploadIntent_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "ClientRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FileAsset"
  ADD CONSTRAINT "FileAsset_onboardingId_fkey"
    FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FileAsset_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "ClientRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FileAsset_uploadIntentId_fkey"
    FOREIGN KEY ("uploadIntentId") REFERENCES "FileUploadIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FileAsset_requirementSubmissionId_fkey"
    FOREIGN KEY ("requirementSubmissionId") REFERENCES "RequirementSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NotificationLog"
  ADD CONSTRAINT "NotificationLog_clientAccessTokenId_fkey"
    FOREIGN KEY ("clientAccessTokenId") REFERENCES "ClientAccessToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_staffActorId_fkey"
    FOREIGN KEY ("staffActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditEvent_clientAccessTokenId_fkey"
    FOREIGN KEY ("clientAccessTokenId") REFERENCES "ClientAccessToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AuditEvent_actor_check" CHECK (
    (
      "actorType" = 'STAFF'
      AND "staffActorId" IS NOT NULL
      AND "clientAccessTokenId" IS NULL
    )
    OR
    (
      "actorType" = 'CLIENT'
      AND "staffActorId" IS NULL
      AND "clientAccessTokenId" IS NOT NULL
    )
    OR
    (
      "actorType" = 'SYSTEM'
      AND "staffActorId" IS NULL
      AND "clientAccessTokenId" IS NULL
    )
  );

CREATE OR REPLACE FUNCTION protect_client_requirement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ClientRequirement records cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."onboardingId" IS DISTINCT FROM OLD."onboardingId"
    OR NEW."templateId" IS DISTINCT FROM OLD."templateId"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."description" IS DISTINCT FROM OLD."description"
    OR NEW."inputType" IS DISTINCT FROM OLD."inputType"
    OR NEW."isRequired" IS DISTINCT FROM OLD."isRequired"
    OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
    OR NEW."dueOffsetDays" IS DISTINCT FROM OLD."dueOffsetDays"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'ClientRequirement snapshot fields are immutable';
  END IF;

  IF OLD."dueAt" IS NOT NULL AND NEW."dueAt" IS DISTINCT FROM OLD."dueAt" THEN
    RAISE EXCEPTION 'ClientRequirement due date is immutable after delivery';
  END IF;

  IF OLD."status" = 'APPROVED'
    AND (
      NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById"
      OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
    )
  THEN
    RAISE EXCEPTION 'Approved ClientRequirement records are terminal';
  END IF;

  IF NEW."currentSubmissionVersion" < OLD."currentSubmissionVersion" THEN
    RAISE EXCEPTION 'ClientRequirement submission version cannot decrease';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'ClientRequirement optimistic version must increment exactly once';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ClientRequirement_protection"
BEFORE UPDATE OR DELETE ON "ClientRequirement"
FOR EACH ROW EXECUTE FUNCTION protect_client_requirement();

CREATE OR REPLACE FUNCTION protect_requirement_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RequirementSubmission records cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."requirementId" IS DISTINCT FROM OLD."requirementId"
    OR NEW."submissionVersion" IS DISTINCT FROM OLD."submissionVersion"
    OR NEW."textValue" IS DISTINCT FROM OLD."textValue"
    OR NEW."urlValue" IS DISTINCT FROM OLD."urlValue"
    OR NEW."submittedViaTokenId" IS DISTINCT FROM OLD."submittedViaTokenId"
    OR NEW."submissionIdempotencyKey" IS DISTINCT FROM OLD."submissionIdempotencyKey"
    OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
    OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'RequirementSubmission identity and content are immutable';
  END IF;

  IF OLD."reviewDecision" IS NOT NULL THEN
    RAISE EXCEPTION 'Terminal RequirementSubmission review is immutable';
  END IF;

  IF NEW."reviewDecision" IS NULL
    OR NEW."reviewedAt" IS NULL
    OR NEW."reviewedById" IS NULL
  THEN
    RAISE EXCEPTION 'RequirementSubmission update must record one terminal review';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "RequirementSubmission_protection"
BEFORE UPDATE OR DELETE ON "RequirementSubmission"
FOR EACH ROW EXECUTE FUNCTION protect_requirement_submission();

CREATE OR REPLACE FUNCTION enforce_rejected_latest_submission()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_requirement_id UUID;
  requirement_row "ClientRequirement"%ROWTYPE;
  latest_decision "RequirementReviewDecision";
BEGIN
  IF TG_TABLE_NAME = 'ClientRequirement' THEN
    target_requirement_id := NEW."id";
  ELSE
    target_requirement_id := NEW."requirementId";
  END IF;

  SELECT * INTO requirement_row
  FROM "ClientRequirement"
  WHERE "id" = target_requirement_id;

  IF requirement_row."status" = 'REJECTED' THEN
    SELECT "reviewDecision" INTO latest_decision
    FROM "RequirementSubmission"
    WHERE "requirementId" = requirement_row."id"
      AND "submissionVersion" = requirement_row."currentSubmissionVersion";

    IF latest_decision IS DISTINCT FROM 'REJECTED'::"RequirementReviewDecision" THEN
      RAISE EXCEPTION 'Rejected requirement must reference a rejected latest submission';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ClientRequirement_rejected_latest_check"
AFTER INSERT OR UPDATE ON "ClientRequirement"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_rejected_latest_submission();

CREATE CONSTRAINT TRIGGER "RequirementSubmission_rejected_latest_check"
AFTER INSERT OR UPDATE ON "RequirementSubmission"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_rejected_latest_submission();

CREATE OR REPLACE FUNCTION protect_client_access_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ClientAccessToken records cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."onboardingId" IS DISTINCT FROM OLD."onboardingId"
    OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
    OR NEW."tokenNonce" IS DISTINCT FROM OLD."tokenNonce"
    OR NEW."tokenVersion" IS DISTINCT FROM OLD."tokenVersion"
    OR NEW."signingKeyVersion" IS DISTINCT FROM OLD."signingKeyVersion"
    OR NEW."issueSequence" IS DISTINCT FROM OLD."issueSequence"
    OR NEW."issuanceKey" IS DISTINCT FROM OLD."issuanceKey"
    OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'ClientAccessToken capability fields are immutable';
  END IF;

  IF OLD."revokedAt" IS NOT NULL
    AND (
      NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
      OR NEW."revocationReason" IS DISTINCT FROM OLD."revocationReason"
      OR NEW."replacedById" IS DISTINCT FROM OLD."replacedById"
    )
  THEN
    RAISE EXCEPTION 'Revoked ClientAccessToken records are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ClientAccessToken_protection"
BEFORE UPDATE OR DELETE ON "ClientAccessToken"
FOR EACH ROW EXECUTE FUNCTION protect_client_access_token();

CREATE OR REPLACE FUNCTION protect_file_upload_intent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FileUploadIntent records cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."clientAccessTokenId" IS DISTINCT FROM OLD."clientAccessTokenId"
    OR NEW."onboardingId" IS DISTINCT FROM OLD."onboardingId"
    OR NEW."requirementId" IS DISTINCT FROM OLD."requirementId"
    OR NEW."expectedInputType" IS DISTINCT FROM OLD."expectedInputType"
    OR NEW."uploadStorageKey" IS DISTINCT FROM OLD."uploadStorageKey"
    OR NEW."finalStorageKey" IS DISTINCT FROM OLD."finalStorageKey"
    OR NEW."originalFilename" IS DISTINCT FROM OLD."originalFilename"
    OR NEW."declaredMimeType" IS DISTINCT FROM OLD."declaredMimeType"
    OR NEW."declaredSizeBytes" IS DISTINCT FROM OLD."declaredSizeBytes"
    OR NEW."declaredChecksum" IS DISTINCT FROM OLD."declaredChecksum"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."requestFingerprint" IS DISTINCT FROM OLD."requestFingerprint"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'FileUploadIntent request and storage identity are immutable';
  END IF;

  IF OLD."status" IN ('FINALIZED', 'EXPIRED', 'REJECTED')
    AND NEW."status" IS DISTINCT FROM OLD."status"
  THEN
    RAISE EXCEPTION 'Terminal FileUploadIntent status is immutable';
  END IF;

  IF NEW."status" = 'FINALIZED' AND NEW."finalizedAt" IS NULL THEN
    RAISE EXCEPTION 'Finalized FileUploadIntent requires finalizedAt';
  END IF;

  IF NEW."status" IN ('EXPIRED', 'REJECTED') AND NEW."failureCode" IS NULL THEN
    RAISE EXCEPTION 'Failed FileUploadIntent requires a failure code';
  END IF;

  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'FileUploadIntent optimistic version must increment exactly once';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FileUploadIntent_protection"
BEFORE UPDATE OR DELETE ON "FileUploadIntent"
FOR EACH ROW EXECUTE FUNCTION protect_file_upload_intent();

CREATE OR REPLACE FUNCTION protect_file_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."requirementSubmissionId" IS NOT NULL THEN
      RAISE EXCEPTION 'Attached FileAsset records cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."onboardingId" IS DISTINCT FROM OLD."onboardingId"
    OR NEW."requirementId" IS DISTINCT FROM OLD."requirementId"
    OR NEW."uploadIntentId" IS DISTINCT FROM OLD."uploadIntentId"
    OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
    OR NEW."originalFilename" IS DISTINCT FROM OLD."originalFilename"
    OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
    OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
    OR NEW."checksum" IS DISTINCT FROM OLD."checksum"
    OR NEW."uploadedAt" IS DISTINCT FROM OLD."uploadedAt"
    OR NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Finalized FileAsset metadata is immutable';
  END IF;

  IF OLD."requirementSubmissionId" IS NOT NULL
    OR NEW."requirementSubmissionId" IS NULL
    OR NEW."displayOrder" IS NULL
  THEN
    RAISE EXCEPTION 'FileAsset may be attached exactly once';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FileAsset_protection"
BEFORE UPDATE OR DELETE ON "FileAsset"
FOR EACH ROW EXECUTE FUNCTION protect_file_asset();

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

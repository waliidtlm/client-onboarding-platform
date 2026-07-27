-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SALES', 'OPERATIONS', 'FINANCE', 'PROJECT_MANAGER', 'DELIVERY');

-- CreateEnum
CREATE TYPE "ActivationType" AS ENUM ('FULL_PAYMENT_PERCENTAGE', 'DEPOSIT_PERCENTAGE', 'FIXED_DEPOSIT_AMOUNT', 'MANUAL_APPROVAL');

-- CreateEnum
CREATE TYPE "RequirementInputType" AS ENUM ('TEXT', 'URL', 'FILE', 'MULTI_FILE');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('SALES_HANDOFF_INCOMPLETE', 'COMMERCIAL_PENDING', 'READY_FOR_ONBOARDING', 'INTERNAL_SETUP', 'INTERNAL_REVIEW', 'CLIENT_AWAITING_ACTION', 'CLIENT_REQUIREMENTS_COMPLETE', 'KICKOFF_PENDING', 'PROJECT_READY', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SalesHandoffStatus" AS ENUM ('PENDING_VALIDATION', 'INCOMPLETE', 'COMPLETE');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'CLOSED_WON', 'CLOSED_LOST');

-- CreateEnum
CREATE TYPE "CommercialGateStatus" AS ENUM ('BLOCKED', 'PENDING_REVIEW', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActivationRequirementStatus" AS ENUM ('NOT_SATISFIED', 'MANUAL_REVIEW_REQUIRED', 'SATISFIED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'PENDING_SIGNATURE', 'REVISION_REQUESTED', 'SIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REVIEW_REQUIRED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "companyName" VARCHAR(200) NOT NULL,
    "contactName" VARCHAR(200) NOT NULL,
    "contactEmail" VARCHAR(320) NOT NULL,
    "contactPhone" VARCHAR(50),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePackage" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activationType" "ActivationType" NOT NULL,
    "activationValue" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ServicePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageProvisioningTemplate" (
    "id" UUID NOT NULL,
    "servicePackageId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "automationKey" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PackageProvisioningTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageRequirementTemplate" (
    "id" UUID NOT NULL,
    "servicePackageId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "inputType" "RequirementInputType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "sequence" INTEGER NOT NULL,
    "dueOffsetDays" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PackageRequirementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onboarding" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "servicePackageId" UUID NOT NULL,
    "externalDealId" VARCHAR(200),
    "dealStatus" "DealStatus" NOT NULL,
    "salesHandoffStatus" "SalesHandoffStatus" NOT NULL,
    "commercialGateStatus" "CommercialGateStatus" NOT NULL,
    "status" "OnboardingStatus" NOT NULL,
    "projectManagerId" UUID,
    "submittedById" UUID NOT NULL,
    "validatedById" UUID,
    "invoiceTotal" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "activationRequiredAmount" DECIMAL(19,4) NOT NULL,
    "activationRequirementStatus" "ActivationRequirementStatus" NOT NULL,
    "activatedAt" TIMESTAMPTZ(3),
    "welcomeEmailSentAt" TIMESTAMPTZ(3),
    "requirementsCompletedAt" TIMESTAMPTZ(3),
    "projectReadyAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancellationReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" UUID NOT NULL,
    "onboardingId" UUID NOT NULL,
    "status" "ContractStatus" NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "signatureDeadline" TIMESTAMPTZ(3),
    "signedAt" TIMESTAMPTZ(3),
    "revisionReason" TEXT,
    "externalReference" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "onboardingId" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "invoiceNumber" VARCHAR(100) NOT NULL,
    "totalAmount" DECIMAL(19,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "overdueAt" TIMESTAMPTZ(3),
    "externalReference" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "originalAmount" DECIMAL(19,4) NOT NULL,
    "verifiedAmount" DECIMAL(19,4),
    "currency" CHAR(3) NOT NULL,
    "verificationStatus" "PaymentVerificationStatus" NOT NULL,
    "discrepancyReason" TEXT,
    "submittedById" UUID NOT NULL,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),
    "externalReference" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_companyName_key" ON "Client"("companyName");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePackage_name_key" ON "ServicePackage"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PackageProvisioningTemplate_servicePackageId_sequence_key" ON "PackageProvisioningTemplate"("servicePackageId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PackageProvisioningTemplate_servicePackageId_automationKey_key" ON "PackageProvisioningTemplate"("servicePackageId", "automationKey");

-- CreateIndex
CREATE UNIQUE INDEX "PackageRequirementTemplate_servicePackageId_sequence_key" ON "PackageRequirementTemplate"("servicePackageId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Onboarding_externalDealId_key" ON "Onboarding"("externalDealId");

-- CreateIndex
CREATE INDEX "Onboarding_status_createdAt_idx" ON "Onboarding"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Onboarding_projectManagerId_idx" ON "Onboarding"("projectManagerId");

-- CreateIndex
CREATE UNIQUE INDEX "Onboarding_id_currency_key" ON "Onboarding"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_externalReference_key" ON "Contract"("externalReference");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_onboardingId_versionNumber_key" ON "Contract"("onboardingId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_externalReference_key" ON "Invoice"("externalReference");

-- CreateIndex
CREATE INDEX "Invoice_onboardingId_idx" ON "Invoice"("onboardingId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_id_currency_key" ON "Invoice"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalReference_key" ON "Payment"("externalReference");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- AddForeignKey
ALTER TABLE "PackageProvisioningTemplate" ADD CONSTRAINT "PackageProvisioningTemplate_servicePackageId_fkey" FOREIGN KEY ("servicePackageId") REFERENCES "ServicePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageRequirementTemplate" ADD CONSTRAINT "PackageRequirementTemplate_servicePackageId_fkey" FOREIGN KEY ("servicePackageId") REFERENCES "ServicePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_servicePackageId_fkey" FOREIGN KEY ("servicePackageId") REFERENCES "ServicePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_onboardingId_currency_fkey" FOREIGN KEY ("onboardingId", "currency") REFERENCES "Onboarding"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_currency_fkey" FOREIGN KEY ("invoiceId", "currency") REFERENCES "Invoice"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL constraints that Prisma Schema Language cannot express.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_lowercase_check"
  CHECK ("email" = lower("email"));

ALTER TABLE "ServicePackage"
  ADD CONSTRAINT "ServicePackage_activationValue_nonnegative_check"
  CHECK ("activationValue" >= 0),
  ADD CONSTRAINT "ServicePackage_percentage_range_check"
  CHECK (
    "activationType" NOT IN ('FULL_PAYMENT_PERCENTAGE', 'DEPOSIT_PERCENTAGE')
    OR "activationValue" BETWEEN 0 AND 100
  );

ALTER TABLE "PackageProvisioningTemplate"
  ADD CONSTRAINT "PackageProvisioningTemplate_sequence_positive_check"
  CHECK ("sequence" > 0);

ALTER TABLE "PackageRequirementTemplate"
  ADD CONSTRAINT "PackageRequirementTemplate_sequence_positive_check"
  CHECK ("sequence" > 0),
  ADD CONSTRAINT "PackageRequirementTemplate_dueOffsetDays_nonnegative_check"
  CHECK ("dueOffsetDays" >= 0);

ALTER TABLE "Onboarding"
  ADD CONSTRAINT "Onboarding_invoiceTotal_nonnegative_check"
  CHECK ("invoiceTotal" >= 0),
  ADD CONSTRAINT "Onboarding_activationRequiredAmount_nonnegative_check"
  CHECK ("activationRequiredAmount" >= 0),
  ADD CONSTRAINT "Onboarding_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Onboarding_version_positive_check"
  CHECK ("version" > 0);

ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_versionNumber_positive_check"
  CHECK ("versionNumber" > 0);

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_totalAmount_nonnegative_check"
  CHECK ("totalAmount" >= 0),
  ADD CONSTRAINT "Invoice_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_originalAmount_nonnegative_check"
  CHECK ("originalAmount" >= 0),
  ADD CONSTRAINT "Payment_verifiedAmount_nonnegative_check"
  CHECK ("verifiedAmount" IS NULL OR "verifiedAmount" >= 0),
  ADD CONSTRAINT "Payment_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Payment_verified_amount_required_check"
  CHECK ("verificationStatus" <> 'VERIFIED' OR "verifiedAmount" IS NOT NULL);

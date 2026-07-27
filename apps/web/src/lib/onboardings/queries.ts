import { can, Permission, type CurrentStaff } from "@/lib/auth/authorization";
import { prisma } from "@/lib/database";
import { formatMoney, presentStoredStatus, type StoredStatus } from "@/lib/onboardings/presenter";

function serializeBaseOnboarding(
  onboarding: StoredStatus & {
    id: string;
    createdAt: Date;
    client: { companyName: string };
    servicePackage: { name: string };
    projectManager: { name: string } | null;
  },
) {
  const presentation = presentStoredStatus(onboarding);

  return {
    id: onboarding.id,
    client: onboarding.client.companyName,
    servicePackage: onboarding.servicePackage.name,
    projectManager: onboarding.projectManager?.name ?? "Unassigned",
    status: onboarding.status,
    commercialGateStatus: onboarding.commercialGateStatus,
    currentBlocker: presentation.currentBlocker,
    nextAction: presentation.nextAction,
    createdAt: onboarding.createdAt.toISOString(),
  };
}

export async function listOnboardings() {
  const records = await prisma.onboarding.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      commercialGateStatus: true,
      activationRequirementStatus: true,
      createdAt: true,
      client: { select: { companyName: true } },
      servicePackage: { select: { name: true } },
      projectManager: { select: { name: true } },
    },
  });

  return records.map(serializeBaseOnboarding);
}

const detailSelect = {
  id: true,
  externalDealId: true,
  dealStatus: true,
  salesHandoffStatus: true,
  status: true,
  commercialGateStatus: true,
  activationRequirementStatus: true,
  version: true,
  createdAt: true,
  client: {
    select: {
      companyName: true,
      contactName: true,
      contactEmail: true,
    },
  },
  servicePackage: {
    select: {
      name: true,
      description: true,
      activationType: true,
      activationValue: true,
      provisioningTemplates: {
        orderBy: { sequence: "asc" as const },
        select: { id: true, name: true, sequence: true, isRequired: true },
      },
      requirementTemplates: {
        orderBy: { sequence: "asc" as const },
        select: {
          id: true,
          name: true,
          sequence: true,
          isRequired: true,
          inputType: true,
        },
      },
    },
  },
  projectManager: { select: { name: true } },
} as const;

export async function getOnboardingDetail(id: string, staff: CurrentStaff) {
  const mayReadCommercial = can(Permission.COMMERCIAL_READ, staff.role);

  const record = await prisma.onboarding.findUnique({
    where: { id },
    select: detailSelect,
  });

  if (!record) {
    return null;
  }

  const commercialRecord = mayReadCommercial
    ? await prisma.onboarding.findUniqueOrThrow({
        where: { id },
        select: {
          invoiceTotal: true,
          activationRequiredAmount: true,
          currency: true,
          contracts: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { status: true, versionNumber: true, signedAt: true },
          },
          invoices: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              totalAmount: true,
              currency: true,
              dueAt: true,
              payments: {
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  originalAmount: true,
                  verifiedAmount: true,
                  currency: true,
                  verificationStatus: true,
                },
              },
            },
          },
        },
      })
    : null;

  const base = serializeBaseOnboarding(record);

  return {
    ...base,
    externalDealId: record.externalDealId,
    dealStatus: record.dealStatus,
    salesHandoffStatus: record.salesHandoffStatus,
    activationRequirementStatus: record.activationRequirementStatus,
    version: record.version,
    clientContact: {
      name: record.client.contactName,
      email: record.client.contactEmail,
    },
    packageConfiguration: {
      name: record.servicePackage.name,
      description: record.servicePackage.description,
      activationType: record.servicePackage.activationType,
      activationValue: record.servicePackage.activationValue.toFixed(4),
      provisioningTemplates: record.servicePackage.provisioningTemplates,
      requirementTemplates: record.servicePackage.requirementTemplates,
    },
    commercial: commercialRecord
      ? {
          invoiceTotal: formatMoney(commercialRecord.invoiceTotal, commercialRecord.currency),
          activationRequiredAmount: formatMoney(
            commercialRecord.activationRequiredAmount,
            commercialRecord.currency,
          ),
          currentContract: commercialRecord.contracts[0]
            ? {
                status: commercialRecord.contracts[0].status,
                versionNumber: commercialRecord.contracts[0].versionNumber,
                signedAt: commercialRecord.contracts[0].signedAt?.toISOString() ?? null,
              }
            : null,
          invoices: commercialRecord.invoices.map((invoice) => ({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            totalAmount: formatMoney(invoice.totalAmount, invoice.currency),
            dueAt: invoice.dueAt.toISOString(),
            payments: invoice.payments.map((payment) => ({
              id: payment.id,
              originalAmount: formatMoney(payment.originalAmount, payment.currency),
              verifiedAmount: payment.verifiedAmount
                ? formatMoney(payment.verifiedAmount, payment.currency)
                : null,
              verificationStatus: payment.verificationStatus,
            })),
          })),
        }
      : null,
  };
}

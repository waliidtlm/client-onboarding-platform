import type { PrismaClient } from "@/generated/prisma/client";
import { can, Permission, type CurrentStaff } from "@/lib/auth/authorization";
import { prisma } from "@/lib/database";
import { validateHttpsUrl } from "@/domain/requirements/submission-validation";
import { formatMoney, presentStoredStatus, type StoredStatus } from "@/lib/onboardings/presenter";
import { calculateProvisioningReadiness } from "@/domain/provisioning/readiness";

function serializeBaseOnboarding(
  onboarding: StoredStatus & {
    id: string;
    createdAt: Date;
    servicePackageNameSnapshot: string | null;
    client: { companyName: string } | null;
    servicePackage: { name: string } | null;
    salesHandoff: { newClientCompanyName: string | null } | null;
    projectManager: { name: string } | null;
    activationInvoice: { status: string; invoiceNumber: string | null; dueAt: Date | null } | null;
  },
) {
  const presentation = presentStoredStatus({
    ...onboarding,
    activationInvoiceReady: Boolean(
      onboarding.activationInvoice &&
      !["DRAFT", "CANCELLED"].includes(onboarding.activationInvoice.status) &&
      onboarding.activationInvoice.invoiceNumber &&
      onboarding.activationInvoice.dueAt,
    ),
  });

  return {
    id: onboarding.id,
    client:
      onboarding.client?.companyName ??
      onboarding.salesHandoff?.newClientCompanyName ??
      "Client not supplied",
    servicePackage:
      onboarding.servicePackageNameSnapshot ??
      onboarding.servicePackage?.name ??
      "Package not selected",
    projectManager: onboarding.projectManager?.name ?? "Unassigned",
    status: onboarding.status,
    commercialGateStatus: onboarding.commercialGateStatus,
    currentBlocker: presentation.currentBlocker,
    nextAction: presentation.nextAction,
    createdAt: onboarding.createdAt.toISOString(),
  };
}

export async function listOnboardings(staff?: CurrentStaff) {
  const records = await prisma.onboarding.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      commercialGateStatus: true,
      commercialGateBlockingReasons: true,
      activationRequirementStatus: true,
      salesHandoffStatus: true,
      servicePackageNameSnapshot: true,
      createdAt: true,
      client: { select: { companyName: true } },
      servicePackage: { select: { name: true } },
      salesHandoff: { select: { newClientCompanyName: true } },
      activationInvoice: {
        select: { status: true, invoiceNumber: true, dueAt: true },
      },
      projectManager: { select: { id: true, name: true } },
    },
  });
  const base = records.map(serializeBaseOnboarding);
  if (!staff || !can(Permission.PROVISIONING_READ, staff.role)) return base;
  const visibleIds = records
    .filter((record) => staff.role !== "PROJECT_MANAGER" || record.projectManager?.id === staff.id)
    .map((record) => record.id);
  const manualReviews = await prisma.provisioningTask.findMany({
    where: {
      onboardingId: { in: visibleIds },
      status: "MANUAL_REVIEW_REQUIRED",
    },
    orderBy: { sequence: "asc" },
    select: { onboardingId: true, name: true, isRequired: true },
  });
  return base.map((item) => {
    const blocker = manualReviews.find((task) => task.onboardingId === item.id && task.isRequired);
    return blocker
      ? {
          ...item,
          currentBlocker: "Provisioning requires manual review",
          nextAction: `Resolve required task: ${blocker.name}`,
        }
      : item;
  });
}

const detailSelect = {
  id: true,
  externalDealId: true,
  dealStatus: true,
  salesHandoffStatus: true,
  status: true,
  commercialGateStatus: true,
  commercialGateBlockingReasons: true,
  commercialGateEvaluatedAt: true,
  activationRequirementStatus: true,
  servicePackageNameSnapshot: true,
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
  projectManager: { select: { id: true, name: true, email: true, isActive: true } },
  salesHandoff: { select: { newClientCompanyName: true } },
  activationInvoice: {
    select: { status: true, invoiceNumber: true, dueAt: true },
  },
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
          activationInvoiceId: true,
          activationRequiredAmount: true,
          currency: true,
          activationTypeSnapshot: true,
          activationValueSnapshot: true,
          manualActivationApprovedAt: true,
          manualActivationRevokedAt: true,
          contracts: {
            orderBy: { versionNumber: "desc" },
            select: {
              id: true,
              status: true,
              versionNumber: true,
              signedAt: true,
              revisionReason: true,
            },
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
                  discrepancyReason: true,
                  version: true,
                },
              },
            },
          },
          commercialExceptions: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              status: true,
              reason: true,
              resolutionNote: true,
              createdAt: true,
              resolvedAt: true,
            },
          },
          auditEvents: {
            where: {
              AND: [
                { action: { not: { startsWith: "PROVISIONING_" } } },
                { action: { notIn: ["INTERNAL_READINESS_APPROVED", "WELCOME_EMAIL_SENT"] } },
              ],
            },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              id: true,
              actorType: true,
              action: true,
              entityType: true,
              previousValue: true,
              newValue: true,
              metadata: true,
              createdAt: true,
              actor: { select: { name: true } },
            },
          },
        },
      })
    : null;

  const mayReadProvisioning =
    can(Permission.PROVISIONING_READ, staff.role) &&
    (staff.role !== "PROJECT_MANAGER" || record.projectManager?.id === staff.id);
  const phase4Record = mayReadProvisioning
    ? await prisma.onboarding.findUniqueOrThrow({
        where: { id },
        select: {
          internalReadinessApprovedAt: true,
          internalReadinessNote: true,
          welcomeEmailSentAt: true,
          provisioningTasks: {
            orderBy: { sequence: "asc" },
            select: {
              id: true,
              name: true,
              description: true,
              sequence: true,
              isRequired: true,
              automationKey: true,
              status: true,
              attemptCount: true,
              maxAttempts: true,
              lastErrorCode: true,
              lastErrorMessage: true,
              externalReference: true,
              version: true,
              manuallyAcceptedAt: true,
              manualAcceptanceReason: true,
              manuallyAcceptedBy: { select: { name: true } },
              attempts: {
                orderBy: { attemptNumber: "desc" },
                select: {
                  id: true,
                  attemptNumber: true,
                  status: true,
                  retryable: true,
                  errorCode: true,
                  errorMessage: true,
                  startedAt: true,
                  completedAt: true,
                },
              },
            },
          },
          notificationLogs: {
            where: { notificationType: "WELCOME_EMAIL" },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              recipient: true,
              attemptCount: true,
              providerReference: true,
              sentAt: true,
              failureReason: true,
            },
          },
          auditEvents: {
            where: {
              OR: [
                { action: { startsWith: "PROVISIONING_" } },
                {
                  action: {
                    in: [
                      "PROJECT_MANAGER_ASSIGNED",
                      "PROJECT_MANAGER_REASSIGNED",
                      "INTERNAL_READINESS_APPROVED",
                      "WELCOME_EMAIL_SENT",
                      "WELCOME_EMAIL_DELIVERY_CONFIRMED",
                      "WELCOME_EMAIL_RESEND_AUTHORIZED",
                    ],
                  },
                },
              ],
            },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              id: true,
              actorType: true,
              action: true,
              entityType: true,
              createdAt: true,
              actor: { select: { name: true } },
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
    commercialGateBlockingReasons: record.commercialGateBlockingReasons,
    commercialGateEvaluatedAt: record.commercialGateEvaluatedAt?.toISOString() ?? null,
    activationRequirementStatus: record.activationRequirementStatus,
    version: record.version,
    projectManagerDetail: record.projectManager,
    clientContact: {
      name: record.client?.contactName ?? "Not supplied",
      email: record.client?.contactEmail ?? "Not supplied",
    },
    packageConfiguration: {
      name:
        record.servicePackageNameSnapshot ?? record.servicePackage?.name ?? "Package not selected",
      description:
        record.servicePackage?.description ?? "Complete the handoff to select a package.",
      activationType: record.servicePackage?.activationType ?? null,
      activationValue: record.servicePackage?.activationValue.toFixed(4) ?? null,
      provisioningTemplates: record.servicePackage?.provisioningTemplates ?? [],
      requirementTemplates: record.servicePackage?.requirementTemplates ?? [],
    },
    commercial: commercialRecord
      ? {
          invoiceTotal:
            commercialRecord.invoiceTotal && commercialRecord.currency
              ? formatMoney(commercialRecord.invoiceTotal, commercialRecord.currency)
              : null,
          currency: commercialRecord.currency,
          activationRequiredAmount:
            commercialRecord.activationRequiredAmount && commercialRecord.currency
              ? formatMoney(commercialRecord.activationRequiredAmount, commercialRecord.currency)
              : null,
          activationTypeSnapshot: commercialRecord.activationTypeSnapshot,
          activationValueSnapshot: commercialRecord.activationValueSnapshot?.toFixed(4) ?? null,
          manualApprovalActive: Boolean(
            commercialRecord.manualActivationApprovedAt &&
            !commercialRecord.manualActivationRevokedAt,
          ),
          currentContract: commercialRecord.contracts[0]
            ? {
                id: commercialRecord.contracts[0].id,
                status: commercialRecord.contracts[0].status,
                versionNumber: commercialRecord.contracts[0].versionNumber,
                signedAt: commercialRecord.contracts[0].signedAt?.toISOString() ?? null,
              }
            : null,
          contracts: commercialRecord.contracts.map((contract) => ({
            ...contract,
            signedAt: contract.signedAt?.toISOString() ?? null,
          })),
          invoices: commercialRecord.invoices.map((invoice) => ({
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            totalAmount: formatMoney(invoice.totalAmount, invoice.currency),
            dueAt: invoice.dueAt?.toISOString() ?? null,
            isActivationInvoice: invoice.id === commercialRecord.activationInvoiceId,
            payments: invoice.payments.map((payment) => ({
              id: payment.id,
              originalAmount: formatMoney(payment.originalAmount, payment.currency),
              verifiedAmount: payment.verifiedAmount
                ? formatMoney(payment.verifiedAmount, payment.currency)
                : null,
              verificationStatus: payment.verificationStatus,
              discrepancyReason: payment.discrepancyReason,
              version: payment.version,
            })),
          })),
          exceptions: commercialRecord.commercialExceptions.map((exception) => ({
            ...exception,
            createdAt: exception.createdAt.toISOString(),
            resolvedAt: exception.resolvedAt?.toISOString() ?? null,
          })),
          auditEvents: commercialRecord.auditEvents.map((event) => ({
            ...event,
            actorName: event.actor?.name ?? "System",
            createdAt: event.createdAt.toISOString(),
          })),
        }
      : null,
    provisioning: phase4Record
      ? {
          readiness: calculateProvisioningReadiness(phase4Record.provisioningTasks),
          internalReadinessApprovedAt:
            phase4Record.internalReadinessApprovedAt?.toISOString() ?? null,
          internalReadinessNote: phase4Record.internalReadinessNote,
          welcomeEmailSentAt: phase4Record.welcomeEmailSentAt?.toISOString() ?? null,
          tasks: phase4Record.provisioningTasks.map((task) => ({
            ...task,
            manuallyAcceptedAt: task.manuallyAcceptedAt?.toISOString() ?? null,
            attempts: task.attempts.map((attempt) => ({
              ...attempt,
              startedAt: attempt.startedAt.toISOString(),
              completedAt: attempt.completedAt?.toISOString() ?? null,
            })),
          })),
          welcomeEmail: phase4Record.notificationLogs[0]
            ? {
                ...phase4Record.notificationLogs[0],
                sentAt: phase4Record.notificationLogs[0].sentAt?.toISOString() ?? null,
              }
            : null,
          auditEvents: phase4Record.auditEvents.map((event) => ({
            ...event,
            actorName: event.actor?.name ?? "System",
            createdAt: event.createdAt.toISOString(),
          })),
        }
      : null,
  };
}

export async function listActiveProjectManagers() {
  return prisma.user.findMany({
    where: { role: "PROJECT_MANAGER", isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
}

export async function getPhase5Detail(
  id: string,
  staff: CurrentStaff,
  database: PrismaClient = prisma,
) {
  if (!can(Permission.CLIENT_REQUIREMENTS_READ, staff.role)) return null;
  const onboarding = await database.onboarding.findUnique({
    where: { id },
    select: {
      projectManagerId: true,
      projectManager: { select: { isActive: true } },
      requirementsGeneratedAt: true,
      clientAccessDeliveredAt: true,
      requirementsCompletedAt: true,
      clientRequirements: {
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          inputType: true,
          isRequired: true,
          sequence: true,
          dueAt: true,
          status: true,
          version: true,
          currentSubmissionVersion: true,
          reviewingSubmissionVersion: true,
        },
      },
      clientAccessTokens: {
        orderBy: { issueSequence: "desc" },
        select: {
          id: true,
          issueSequence: true,
          expiresAt: true,
          revokedAt: true,
          revocationReason: true,
          createdAt: true,
          notification: {
            select: {
              id: true,
              status: true,
              recipient: true,
              attemptCount: true,
              providerReference: true,
              sentAt: true,
              failureReason: true,
            },
          },
        },
      },
      auditEvents: {
        where: {
          action: {
            in: [
              "CLIENT_REQUIREMENTS_GENERATED",
              "CLIENT_ACCESS_ISSUED",
              "CLIENT_ACCESS_REISSUED",
              "CLIENT_ACCESS_REVOKED",
              "CLIENT_ACCESS_EMAIL_SENT",
              "CLIENT_ACCESS_EMAIL_DELIVERY_CONFIRMED",
              "CLIENT_ACCESS_EMAIL_RESEND_AUTHORIZED",
              "CLIENT_REQUIREMENT_SUBMITTED",
              "CLIENT_REQUIREMENT_RESUBMITTED",
              "CLIENT_REQUIREMENT_REVIEW_STARTED",
              "CLIENT_REQUIREMENT_APPROVED",
              "CLIENT_REQUIREMENT_REJECTED",
              "ALL_MANDATORY_CLIENT_REQUIREMENTS_COMPLETED",
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          actorType: true,
          action: true,
          entityType: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      },
    },
  });
  if (!onboarding) return null;
  if (
    staff.role === "PROJECT_MANAGER" &&
    (onboarding.projectManagerId !== staff.id || !onboarding.projectManager?.isActive)
  ) {
    return null;
  }
  const mayReadContent = can(Permission.CLIENT_REQUIREMENTS_CONTENT_READ, staff.role);
  const contentSubmissions = mayReadContent
    ? await database.requirementSubmission.findMany({
        where: {
          requirement: {
            onboarding: {
              id,
              ...(staff.role === "PROJECT_MANAGER"
                ? {
                    projectManagerId: staff.id,
                    projectManager: { isActive: true },
                  }
                : {}),
            },
          },
        },
        orderBy: [{ requirementId: "asc" }, { submissionVersion: "desc" }],
        include: {
          files: {
            orderBy: { displayOrder: "asc" },
            select: {
              id: true,
              originalFilename: true,
              mimeType: true,
              sizeBytes: true,
            },
          },
        },
      })
    : [];
  type ContentSubmission = (typeof contentSubmissions)[number];
  const submissionsByRequirement = new Map<string, ContentSubmission[]>();
  for (const submission of contentSubmissions) {
    const grouped = submissionsByRequirement.get(submission.requirementId) ?? [];
    grouped.push(submission);
    submissionsByRequirement.set(submission.requirementId, grouped);
  }
  return {
    requirementsGeneratedAt: onboarding.requirementsGeneratedAt?.toISOString() ?? null,
    clientAccessDeliveredAt: onboarding.clientAccessDeliveredAt?.toISOString() ?? null,
    requirementsCompletedAt: onboarding.requirementsCompletedAt?.toISOString() ?? null,
    contentVisible: mayReadContent,
    requirements: onboarding.clientRequirements.map((requirement) => {
      const submissions = submissionsByRequirement.get(requirement.id) ?? [];
      const mappedSubmissions = submissions.map((submission) => ({
        id: submission.id,
        submissionVersion: submission.submissionVersion,
        submittedAt: submission.submittedAt.toISOString(),
        reviewedAt: submission.reviewedAt?.toISOString() ?? null,
        reviewDecision: submission.reviewDecision,
        reviewReason: submission.reviewReason,
        textValue: submission.textValue,
        urlValue: submission.urlValue ? validateHttpsUrl(submission.urlValue) : null,
        fileCount: submission.files.length,
        files: submission.files.map((file) => ({
          ...file,
          sizeBytes: file.sizeBytes.toString(),
        })),
      }));
      return {
        id: requirement.id,
        name: requirement.name,
        description: requirement.description,
        inputType: requirement.inputType,
        isRequired: requirement.isRequired,
        sequence: requirement.sequence,
        dueAt: requirement.dueAt?.toISOString() ?? null,
        status: requirement.status,
        version: requirement.version,
        currentSubmissionVersion: requirement.currentSubmissionVersion,
        reviewingSubmissionVersion: requirement.reviewingSubmissionVersion,
        latestSubmission: mappedSubmissions[0] ?? null,
        previousSubmissions: mappedSubmissions.slice(1),
      };
    }),
    tokens: onboarding.clientAccessTokens.map((token) => ({
      ...token,
      expiresAt: token.expiresAt.toISOString(),
      revokedAt: token.revokedAt?.toISOString() ?? null,
      createdAt: token.createdAt.toISOString(),
      notification: token.notification
        ? {
            ...token.notification,
            sentAt: token.notification.sentAt?.toISOString() ?? null,
          }
        : null,
    })),
    auditEvents: onboarding.auditEvents.map((event) => ({
      ...event,
      actorName: event.actor?.name ?? "System / client",
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function getSalesHandoffFormData(onboardingId?: string) {
  const [clients, packages, handoff] = await Promise.all([
    prisma.client.findMany({
      orderBy: { companyName: "asc" },
      select: { id: true, companyName: true },
    }),
    prisma.servicePackage.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    onboardingId
      ? prisma.salesHandoff.findUnique({
          where: { onboardingId },
          include: { onboarding: { select: { version: true, status: true } } },
        })
      : Promise.resolve(null),
  ]);

  return {
    clients,
    packages,
    handoff: handoff
      ? {
          ...handoff,
          agreedTotal: handoff.agreedTotal?.toFixed(4) ?? null,
          createdAt: handoff.createdAt.toISOString(),
          updatedAt: handoff.updatedAt.toISOString(),
        }
      : null,
  };
}

import type { PrismaClient } from "@/generated/prisma/client";
import { validateHttpsUrl } from "@/domain/requirements/submission-validation";
import { prisma } from "@/lib/database";

export async function loadClientPortal(
  onboardingId: string,
  tokenId: string,
  database: PrismaClient = prisma,
) {
  const onboarding = await database.onboarding.findFirst({
    where: {
      id: onboardingId,
      cancelledAt: null,
      clientAccessTokens: {
        some: {
          id: tokenId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      },
    },
    select: {
      id: true,
      status: true,
      servicePackageNameSnapshot: true,
      clientAccessDeliveredAt: true,
      requirementsCompletedAt: true,
      client: { select: { companyName: true } },
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
          submissions: {
            orderBy: { submissionVersion: "desc" },
            select: {
              id: true,
              submissionVersion: true,
              textValue: true,
              urlValue: true,
              submittedAt: true,
              reviewedAt: true,
              reviewDecision: true,
              reviewReason: true,
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
          },
        },
      },
    },
  });
  if (!onboarding) return null;
  return {
    id: onboarding.id,
    status: onboarding.status,
    clientCompany: onboarding.client?.companyName ?? "Client",
    packageName: onboarding.servicePackageNameSnapshot ?? "Service package",
    clientAccessDeliveredAt: onboarding.clientAccessDeliveredAt?.toISOString() ?? null,
    requirementsCompletedAt: onboarding.requirementsCompletedAt?.toISOString() ?? null,
    requirements: onboarding.clientRequirements.map((requirement) => {
      const latest = requirement.submissions[0];
      const mapSubmission = (submission: (typeof requirement.submissions)[number]) => ({
        ...submission,
        urlValue: submission.urlValue ? validateHttpsUrl(submission.urlValue) : null,
        submittedAt: submission.submittedAt.toISOString(),
        reviewedAt: submission.reviewedAt?.toISOString() ?? null,
        files: submission.files.map((file) => ({
          ...file,
          sizeBytes: file.sizeBytes.toString(),
        })),
      });
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
        latestSubmission: latest ? mapSubmission(latest) : null,
        previousSubmissions: requirement.submissions.slice(1).map(mapSubmission),
      };
    }),
  };
}

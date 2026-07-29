import { DeliveryHandoffStatus, OnboardingStatus, Role } from "@/generated/prisma/client";

import type { CurrentStaff } from "@/lib/auth/authorization";
import { prisma } from "@/lib/database";
import { validateHttpsUrl } from "@/domain/requirements/submission-validation";

export async function listActiveDeliveryUsers() {
  return prisma.user.findMany({
    where: { role: Role.DELIVERY, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

export async function loadPhase6Workspace(onboardingId: string, staff: CurrentStaff) {
  const isDelivery = staff.role === Role.DELIVERY;
  const onboarding = await prisma.onboarding.findFirst({
    where: {
      id: onboardingId,
      ...(isDelivery
        ? {
            status: { in: [OnboardingStatus.PROJECT_READY, OnboardingStatus.COMPLETED] },
            deliveryHandoff: {
              is: {
                assignedDeliveryUserId: staff.id,
                status: {
                  in: [
                    DeliveryHandoffStatus.READY,
                    DeliveryHandoffStatus.NOTIFIED,
                    DeliveryHandoffStatus.ACKNOWLEDGED,
                  ],
                },
              },
            },
          }
        : staff.role === Role.PROJECT_MANAGER
          ? { projectManagerId: staff.id, projectManager: { is: { isActive: true } } }
          : {}),
    },
    select: {
      id: true,
      status: true,
      version: true,
      projectReadyAt: true,
      completedAt: true,
      slaTargetHoursSnapshot: true,
      slaResult: true,
      servicePackageNameSnapshot: true,
      notificationLogs: isDelivery
        ? false
        : {
            where: {
              notificationType: {
                in: ["KICKOFF_INVITATION", "DELIVERY_HANDOFF_NOTIFICATION", "PHASE6_CANCELLATION"],
              },
            },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: {
              id: true,
              notificationType: true,
              status: true,
              businessRevision: true,
              failureReason: true,
            },
          },
      client: { select: { companyName: true } },
      kickoff: {
        select: {
          id: true,
          status: true,
          version: true,
          scheduledStartAt: true,
          timezone: true,
          meetingUrl: true,
          meetingLocation: true,
          scheduleRevision: true,
          outcomeNotes: true,
          completedAt: true,
          invitationWaivedAt: true,
          invitationWaiverReason: true,
          notifications: isDelivery
            ? false
            : {
                orderBy: { createdAt: "desc" },
                take: 5,
                select: {
                  id: true,
                  notificationType: true,
                  status: true,
                  businessRevision: true,
                  sentAt: true,
                },
              },
        },
      },
      deliveryHandoff: {
        select: {
          id: true,
          status: true,
          version: true,
          summary: true,
          riskNotes: true,
          nextActions: true,
          sourceSnapshot: true,
          sourceFingerprint: true,
          summarySchemaVersion: true,
          assignmentRevision: true,
          preparedAt: true,
          acknowledgedAt: true,
          acknowledgedAsAdminException: true,
          assignedDeliveryUser: { select: { id: true, name: true, email: true, isActive: true } },
          notifications: isDelivery
            ? false
            : {
                orderBy: { createdAt: "desc" },
                take: 5,
                select: {
                  id: true,
                  status: true,
                  businessRevision: true,
                  sentAt: true,
                },
              },
        },
      },
      clientRequirements: {
        where: { status: "APPROVED" },
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          name: true,
          currentSubmissionVersion: true,
          submissions: {
            where: { reviewDecision: "APPROVED" },
            orderBy: { submissionVersion: "desc" },
            take: 1,
            select: {
              submissionVersion: true,
              textValue: true,
              urlValue: true,
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
    ...onboarding,
    phase6Notifications:
      "notificationLogs" in onboarding ? (onboarding.notificationLogs ?? []) : [],
    projectReadyAt: onboarding.projectReadyAt?.toISOString() ?? null,
    completedAt: onboarding.completedAt?.toISOString() ?? null,
    kickoff: onboarding.kickoff
      ? {
          ...onboarding.kickoff,
          scheduledStartAt: onboarding.kickoff.scheduledStartAt?.toISOString() ?? null,
          completedAt: onboarding.kickoff.completedAt?.toISOString() ?? null,
          invitationWaivedAt: onboarding.kickoff.invitationWaivedAt?.toISOString() ?? null,
          meetingUrl: onboarding.kickoff.meetingUrl
            ? validateHttpsUrl(onboarding.kickoff.meetingUrl)
            : null,
          notifications:
            "notifications" in onboarding.kickoff
              ? (onboarding.kickoff.notifications ?? []).map((notification) => ({
                  ...notification,
                  sentAt: notification.sentAt?.toISOString() ?? null,
                }))
              : [],
        }
      : null,
    deliveryHandoff: onboarding.deliveryHandoff
      ? {
          ...onboarding.deliveryHandoff,
          preparedAt: onboarding.deliveryHandoff.preparedAt?.toISOString() ?? null,
          acknowledgedAt: onboarding.deliveryHandoff.acknowledgedAt?.toISOString() ?? null,
          notifications:
            "notifications" in onboarding.deliveryHandoff
              ? (onboarding.deliveryHandoff.notifications ?? []).map((notification) => ({
                  ...notification,
                  sentAt: notification.sentAt?.toISOString() ?? null,
                }))
              : [],
        }
      : null,
    requirements: onboarding.clientRequirements.map((requirement) => ({
      id: requirement.id,
      name: requirement.name,
      submission: requirement.submissions[0]
        ? {
            ...requirement.submissions[0],
            urlValue: requirement.submissions[0].urlValue
              ? validateHttpsUrl(requirement.submissions[0].urlValue)
              : null,
            files: requirement.submissions[0].files.map((file) => ({
              ...file,
              sizeBytes: file.sizeBytes.toString(),
            })),
          }
        : null,
    })),
  };
}

import {
  AuditActorType,
  NotificationChannel,
  NotificationStatus,
  Prisma,
  Role,
  type PrismaClient,
} from "@/generated/prisma/client";

import { evaluateRemindersSchema } from "@/application/reminders/contracts";
import { appendAuditEvent } from "@/application/commercial/audit";
import {
  executeService,
  parseInput,
  type TransactionClient,
} from "@/application/commercial/service-support";
import {
  dueReminderWindows,
  reminderEventKey,
  reminderKey,
  type ReminderAudience,
  type ReminderCategory,
  type ReminderPolicyWindow,
} from "@/domain/reminders/policy";
import { prisma } from "@/lib/database";
import { getServerEnvironment } from "@/lib/env";

const TEMPLATE_VERSION = 1;
const SENDER_KEY = "NORTHSTAR_REMINDER_V1";
const ACTIVE_ONBOARDING_STATUSES = [
  "CLIENT_AWAITING_ACTION",
  "CLIENT_REQUIREMENTS_COMPLETE",
  "KICKOFF_PENDING",
  "INTERNAL_SETUP",
  "INTERNAL_REVIEW",
  "PROJECT_READY",
] as const;

type ReminderCandidate = Readonly<{
  category: ReminderCategory;
  subjectId: string;
  onboardingId: string;
  onboardingStatus: string;
  subjectStatus: string;
  anchorAt: Date;
  clientCompany: string;
  clientContactName: string;
  clientEmail: string;
  projectManager: Readonly<{ id: string; name: string; email: string; isActive: boolean }> | null;
  delivery: Readonly<{ id: string; name: string; email: string; isActive: boolean }> | null;
  subjectLabel: string;
}>;

type Recipient = Readonly<{
  audience: ReminderAudience;
  email: string;
  name: string;
}>;

async function primaryRoleRecipient(tx: TransactionClient, role: Role) {
  return tx.user.findFirst({
    where: { role, isActive: true },
    orderBy: [{ email: "asc" }, { id: "asc" }],
    select: { id: true, name: true, email: true, isActive: true },
  });
}

function notificationCopy(
  candidate: ReminderCandidate,
  window: ReminderPolicyWindow,
  recipient: Recipient,
) {
  const categoryLabel = candidate.category.replaceAll("_", " ").toLowerCase();
  const subject = `[${window.code.replaceAll("_", " ")}] ${candidate.clientCompany}: ${categoryLabel}`;
  const textContent = [
    `Hello ${recipient.name},`,
    "",
    `This is a bounded onboarding reminder for ${candidate.clientCompany}.`,
    `Action: ${candidate.subjectLabel}.`,
    `Policy window: ${window.code}.`,
    "",
    "Open the onboarding workspace to review the current authoritative status. This message contains no client access link or private file content.",
  ].join("\n");
  return { subject, textContent };
}

async function resolveRecipient(
  tx: TransactionClient,
  candidate: ReminderCandidate,
  requestedAudience: ReminderAudience,
  operations: Awaited<ReturnType<typeof primaryRoleRecipient>>,
  admin: Awaited<ReturnType<typeof primaryRoleRecipient>>,
): Promise<Recipient | null> {
  if (requestedAudience === "CLIENT") {
    return {
      audience: "CLIENT",
      email: candidate.clientEmail,
      name: candidate.clientContactName,
    };
  }
  if (requestedAudience === "PROJECT_MANAGER" && candidate.projectManager?.isActive) {
    return {
      audience: "PROJECT_MANAGER",
      email: candidate.projectManager.email,
      name: candidate.projectManager.name,
    };
  }
  if (requestedAudience === "DELIVERY" && candidate.delivery?.isActive) {
    return {
      audience: "DELIVERY",
      email: candidate.delivery.email,
      name: candidate.delivery.name,
    };
  }
  if (requestedAudience === "OPERATIONS" && operations?.isActive) {
    return { audience: "OPERATIONS", email: operations.email, name: operations.name };
  }
  if (admin?.isActive) {
    return { audience: "ADMIN", email: admin.email, name: admin.name };
  }
  return null;
}

async function loadCandidates(tx: TransactionClient, now: Date): Promise<ReminderCandidate[]> {
  const [requirements, tasks, kickoffs, handoffs] = await Promise.all([
    tx.clientRequirement.findMany({
      where: {
        isRequired: true,
        dueAt: { not: null, lte: new Date(now.getTime() + 48 * 3_600_000) },
        status: { in: ["PENDING", "REJECTED"] },
        onboarding: { status: { in: [...ACTIVE_ONBOARDING_STATUSES] } },
      },
      include: {
        onboarding: {
          include: {
            client: true,
            projectManager: {
              select: { id: true, name: true, email: true, isActive: true },
            },
          },
        },
      },
      take: 100,
    }),
    tx.provisioningTask.findMany({
      where: {
        status: "MANUAL_REVIEW_REQUIRED",
        onboarding: { status: { in: [...ACTIVE_ONBOARDING_STATUSES] } },
      },
      include: {
        onboarding: {
          include: {
            client: true,
            projectManager: {
              select: { id: true, name: true, email: true, isActive: true },
            },
          },
        },
      },
      take: 100,
    }),
    tx.kickoff.findMany({
      where: {
        status: "PENDING",
        onboarding: {
          status: { in: ["CLIENT_REQUIREMENTS_COMPLETE", "KICKOFF_PENDING"] },
        },
      },
      include: {
        onboarding: {
          include: {
            client: true,
            projectManager: {
              select: { id: true, name: true, email: true, isActive: true },
            },
          },
        },
      },
      take: 100,
    }),
    tx.deliveryHandoff.findMany({
      where: {
        status: "NOTIFIED",
        onboarding: { status: "PROJECT_READY" },
      },
      include: {
        assignedDeliveryUser: {
          select: { id: true, name: true, email: true, isActive: true },
        },
        onboarding: {
          include: {
            client: true,
            projectManager: {
              select: { id: true, name: true, email: true, isActive: true },
            },
            notificationLogs: {
              where: {
                notificationType: "DELIVERY_HANDOFF_NOTIFICATION",
                status: "SENT",
              },
              orderBy: { sentAt: "desc" },
              take: 1,
              select: { sentAt: true },
            },
          },
        },
      },
      take: 100,
    }),
  ]);
  return [
    ...requirements.flatMap((item): ReminderCandidate[] =>
      item.dueAt && item.onboarding.client
        ? [
            {
              category: "CLIENT_REQUIREMENT",
              subjectId: item.id,
              onboardingId: item.onboardingId,
              onboardingStatus: item.onboarding.status,
              subjectStatus: item.status,
              anchorAt: item.dueAt,
              clientCompany: item.onboarding.client.companyName,
              clientContactName: item.onboarding.client.contactName,
              clientEmail: item.onboarding.client.contactEmail,
              projectManager: item.onboarding.projectManager,
              delivery: null,
              subjectLabel: `Provide the mandatory requirement "${item.name}"`,
            },
          ]
        : [],
    ),
    ...tasks.flatMap((item): ReminderCandidate[] =>
      item.onboarding.client
        ? [
            {
              category: "PROVISIONING_MANUAL_REVIEW",
              subjectId: item.id,
              onboardingId: item.onboardingId,
              onboardingStatus: item.onboarding.status,
              subjectStatus: item.status,
              anchorAt: item.updatedAt,
              clientCompany: item.onboarding.client.companyName,
              clientContactName: item.onboarding.client.contactName,
              clientEmail: item.onboarding.client.contactEmail,
              projectManager: item.onboarding.projectManager,
              delivery: null,
              subjectLabel: `Resolve provisioning review for "${item.name}"`,
            },
          ]
        : [],
    ),
    ...kickoffs.flatMap((item): ReminderCandidate[] =>
      item.onboarding.client
        ? [
            {
              category: "KICKOFF_UNSCHEDULED",
              subjectId: item.id,
              onboardingId: item.onboardingId,
              onboardingStatus: item.onboarding.status,
              subjectStatus: item.status,
              anchorAt: item.onboarding.requirementsCompletedAt ?? item.createdAt,
              clientCompany: item.onboarding.client.companyName,
              clientContactName: item.onboarding.client.contactName,
              clientEmail: item.onboarding.client.contactEmail,
              projectManager: item.onboarding.projectManager,
              delivery: null,
              subjectLabel: "Schedule the client kickoff",
            },
          ]
        : [],
    ),
    ...handoffs.flatMap((item): ReminderCandidate[] =>
      item.onboarding.client
        ? [
            {
              category: "DELIVERY_HANDOFF_UNACKNOWLEDGED",
              subjectId: item.id,
              onboardingId: item.onboardingId,
              onboardingStatus: item.onboarding.status,
              subjectStatus: item.status,
              anchorAt: item.onboarding.notificationLogs[0]?.sentAt ?? item.updatedAt,
              clientCompany: item.onboarding.client.companyName,
              clientContactName: item.onboarding.client.contactName,
              clientEmail: item.onboarding.client.contactEmail,
              projectManager: item.onboarding.projectManager,
              delivery: item.assignedDeliveryUser,
              subjectLabel: "Acknowledge the Delivery handoff",
            },
          ]
        : [],
    ),
  ];
}

export async function evaluateDueReminders(rawInput: unknown, database: PrismaClient = prisma) {
  return executeService(async () => {
    const input = parseInput(evaluateRemindersSchema.safeParse(rawInput));
    const environment = getServerEnvironment();
    return database.$transaction(
      async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('phase7-reminder-evaluation', 0))`,
        );
        const clock = await tx.$queryRaw<Array<{ now: Date }>>(
          Prisma.sql`SELECT CURRENT_TIMESTAMP AS "now"`,
        );
        const now = clock[0]!.now;
        const [candidates, operations, admin] = await Promise.all([
          loadCandidates(tx, now),
          primaryRoleRecipient(tx, Role.OPERATIONS),
          primaryRoleRecipient(tx, Role.ADMIN),
        ]);
        const created: string[] = [];
        let skipped = 0;
        for (const candidate of candidates) {
          const windows = dueReminderWindows({
            category: candidate.category,
            anchorAt: candidate.anchorAt,
            now,
            onboardingStatus: candidate.onboardingStatus,
            subjectStatus: candidate.subjectStatus,
          });
          for (const window of windows) {
            const recipient = await resolveRecipient(
              tx,
              candidate,
              window.audience,
              operations,
              admin,
            );
            if (!recipient || !recipient.email.toLowerCase().endsWith(".test")) {
              if (environment.DEPLOYMENT_PROFILE === "local") {
                skipped += 1;
                continue;
              }
              if (!recipient) {
                skipped += 1;
                continue;
              }
            }
            const effectiveWindow =
              recipient.audience === window.audience
                ? window.code
                : `${window.code}_FALLBACK_${recipient.audience}`;
            const key = reminderKey({
              category: candidate.category,
              audience: recipient.audience,
              aggregateId: candidate.subjectId,
              policyWindow: effectiveWindow,
            });
            if (await tx.notificationLog.findUnique({ where: { idempotencyKey: key } })) {
              skipped += 1;
              continue;
            }
            const copy = notificationCopy(candidate, window, recipient);
            const notification = await tx.notificationLog.create({
              data: {
                onboardingId: candidate.onboardingId,
                notificationType: candidate.category,
                recipient: recipient.email,
                channel: NotificationChannel.EMAIL,
                status: NotificationStatus.PENDING,
                idempotencyKey: key,
                senderKey: SENDER_KEY,
                senderName: environment.AGENCY_NAME,
                senderAddress: environment.CLIENT_SUPPORT_CONTACT,
                subject: copy.subject,
                textContent: copy.textContent,
                htmlContent: null,
                templateVersion: TEMPLATE_VERSION,
                messageKey: key,
                kickoffId:
                  candidate.category === "KICKOFF_UNSCHEDULED" ? candidate.subjectId : null,
                deliveryHandoffId:
                  candidate.category === "DELIVERY_HANDOFF_UNACKNOWLEDGED"
                    ? candidate.subjectId
                    : null,
              },
            });
            await tx.automationEvent.create({
              data: {
                eventType: "REMINDER_NOTIFICATION_REQUESTED",
                aggregateType: "ONBOARDING",
                aggregateId: candidate.onboardingId,
                payload: {
                  notificationId: notification.id,
                  category: candidate.category,
                  subjectId: candidate.subjectId,
                  policyWindow: effectiveWindow,
                },
                schemaVersion: 1,
                maxAttempts: environment.AUTOMATION_MAX_ATTEMPTS,
                availableAt: now,
                occurredAt: now,
                correlationId: input.requestId,
                deduplicationKey: reminderEventKey(notification.id),
              },
            });
            await appendAuditEvent(tx, {
              onboardingId: candidate.onboardingId,
              actorType: AuditActorType.SYSTEM,
              action: "REMINDER_NOTIFICATION_QUEUED",
              entityType: "NOTIFICATION",
              entityId: notification.id,
              newValue: {
                category: candidate.category,
                audience: recipient.audience,
                policyWindow: effectiveWindow,
              },
              correlationId: input.requestId,
            });
            created.push(notification.id);
          }
        }
        return {
          evaluatedAt: now.toISOString(),
          candidateCount: candidates.length,
          createdCount: created.length,
          skippedCount: skipped,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
}

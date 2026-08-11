import { prisma } from "@/lib/database";
import { AutomationEventStatus, Prisma } from "@/generated/prisma/client";

const FILTERABLE_STATUSES = [
  AutomationEventStatus.FAILED,
  AutomationEventStatus.DEAD_LETTER,
  AutomationEventStatus.PENDING,
  AutomationEventStatus.PROCESSING,
  AutomationEventStatus.COMPLETED,
] as const;

export type AutomationRecoveryStatusFilter =
  (typeof FILTERABLE_STATUSES)[number] | "ACTION_REQUIRED" | "ALL";

function normalizeFilter(value: string | undefined): AutomationRecoveryStatusFilter {
  if (value === "ALL" || value === "ACTION_REQUIRED") return value;
  return FILTERABLE_STATUSES.includes(value as (typeof FILTERABLE_STATUSES)[number])
    ? (value as (typeof FILTERABLE_STATUSES)[number])
    : "ACTION_REQUIRED";
}

function safeFailureSummary(event: {
  status: AutomationEventStatus;
  lastErrorCode: string | null;
}): string {
  const summaries: Readonly<Record<string, string>> = {
    ATTEMPTS_EXHAUSTED: "Automatic attempts were exhausted. Review the dedicated recovery path.",
    EMAIL_DELIVERY_UNCERTAIN:
      "Email delivery could not be confirmed. Verify delivery before taking another action.",
    INVALID_BUSINESS_STATE:
      "The onboarding state no longer matched the operation's eligibility rules.",
    LEASE_EXPIRED: "The worker lease expired before the operation could be confirmed.",
    MISSING_BUSINESS_CONFIGURATION:
      "Required onboarding configuration is missing and needs staff review.",
    OPERATIONAL_HOLD: "The operation stopped for a staff-reviewable business condition.",
    PROVIDER_TEMPORARY_FAILURE:
      "A provider operation failed temporarily. Review current eligibility before retrying.",
    RATE_LIMITED: "A provider rate limit prevented the operation from completing.",
    TEMPORARY_PROVIDER_FAILURE:
      "A provider operation failed temporarily. Review current eligibility before retrying.",
    UPSTREAM_5XX: "An upstream service failed temporarily during the operation.",
  };
  const controlledSummary = event.lastErrorCode ? summaries[event.lastErrorCode] : undefined;
  if (controlledSummary) return controlledSummary;
  return event.status === AutomationEventStatus.DEAD_LETTER
    ? "The event stopped without a safe automatic recovery path."
    : "The event failed and requires review through its dedicated recovery path.";
}

function recoveryAdvice(event: {
  eventType: string;
  status: AutomationEventStatus;
  lastErrorCode: string | null;
  attemptCount: number;
  maxAttempts: number;
  onboarding: {
    status: string;
    activatedAt: Date | null;
    provisioningTasks: Array<{ id: string; status: string }>;
    notificationLogs: Array<{ id: string; status: string; notificationType: string }>;
  };
  payload: unknown;
  runs: Array<{ status: string; failureClassification: string | null }>;
}) {
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};
  const lastRun = event.runs[0];
  if (event.lastErrorCode === "EMAIL_DELIVERY_UNCERTAIN") {
    return {
      canRetry: false,
      recommendedAction:
        "Verify delivery, then use the onboarding's dedicated email uncertainty control.",
      recoveryHref: "ONBOARDING" as const,
    };
  }
  if (event.eventType === "PROVISIONING_TASK_REQUESTED") {
    const task = event.onboarding.provisioningTasks.find((item) => item.id === payload.taskId);
    return {
      canRetry: false,
      recommendedAction:
        task?.status === "MANUAL_REVIEW_REQUIRED"
          ? "Use the onboarding's provisioning manual-review control."
          : "Open the onboarding and review the current provisioning task state.",
      recoveryHref: "ONBOARDING" as const,
    };
  }
  if (
    event.eventType === "WELCOME_EMAIL_REQUESTED" ||
    event.eventType === "CLIENT_ACCESS_EMAIL_REQUESTED" ||
    event.eventType.includes("NOTIFICATION") ||
    event.eventType === "KICKOFF_INVITATION_REQUESTED"
  ) {
    const notification = event.onboarding.notificationLogs.find(
      (item) => item.id === payload.notificationId,
    );
    return {
      canRetry: false,
      recommendedAction:
        notification?.status === "DELIVERY_UNCERTAIN"
          ? "Verify delivery, then use the onboarding's dedicated uncertainty control."
          : "Open the onboarding and use the notification-specific recovery control.",
      recoveryHref: "ONBOARDING" as const,
    };
  }
  const activationEligible =
    event.eventType === "ONBOARDING_ACTIVATED" &&
    event.onboarding.status === "READY_FOR_ONBOARDING" &&
    Boolean(event.onboarding.activatedAt) &&
    ((event.status === AutomationEventStatus.FAILED &&
      lastRun?.failureClassification === "OPERATOR_REMEDIABLE") ||
      (event.status === AutomationEventStatus.DEAD_LETTER &&
        (lastRun?.failureClassification === "RETRYABLE" ||
          lastRun?.status === "TIMED_OUT" ||
          event.lastErrorCode === "ATTEMPTS_EXHAUSTED")));
  if (activationEligible) {
    return {
      canRetry: true,
      recommendedAction: "Review the safe failure summary and authorize exactly one retry.",
      recoveryHref: null,
    };
  }
  return {
    canRetry: false,
    recommendedAction:
      event.status === AutomationEventStatus.FAILED ||
      event.status === AutomationEventStatus.DEAD_LETTER
        ? "Open the related onboarding, verify current eligibility, and use its dedicated control."
        : "No recovery action is required for the current status.",
    recoveryHref: "ONBOARDING" as const,
  };
}

export async function listAutomationEventsForRecovery(statusValue?: string) {
  const status = normalizeFilter(statusValue);
  const where: Prisma.AutomationEventWhereInput | undefined =
    status === "ALL"
      ? undefined
      : status === "ACTION_REQUIRED"
        ? {
            status: {
              in: [AutomationEventStatus.FAILED, AutomationEventStatus.DEAD_LETTER],
            },
          }
        : { status };
  const query = {
    ...(where ? { where } : {}),
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      onboarding: {
        include: {
          client: { select: { companyName: true } },
          provisioningTasks: { select: { id: true, status: true } },
          notificationLogs: { select: { id: true, status: true, notificationType: true } },
        },
      },
      runs: {
        orderBy: { attemptNumber: "desc" },
        select: {
          id: true,
          attemptNumber: true,
          status: true,
          errorCode: true,
          failureClassification: true,
          failureReportedAt: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  } satisfies Prisma.AutomationEventFindManyArgs;
  const events = await prisma.automationEvent.findMany(query);
  return {
    selectedStatus: status,
    events: events.map((event) => {
      const advice = recoveryAdvice(event);
      return {
        id: event.id,
        eventType: event.eventType,
        status: event.status,
        onboardingId: event.aggregateId,
        clientCompanyName: event.onboarding.client?.companyName ?? "Unknown client",
        attemptCount: event.attemptCount,
        maxAttempts: event.maxAttempts,
        availableAt: event.availableAt.toISOString(),
        lastErrorCode: event.lastErrorCode,
        safeFailureSummary: safeFailureSummary(event),
        lastFailureAt:
          event.runs[0]?.failureReportedAt?.toISOString() ??
          event.runs[0]?.completedAt?.toISOString() ??
          null,
        createdAt: event.createdAt.toISOString(),
        ...advice,
        runs: event.runs.map((run) => ({
          id: run.id,
          attemptNumber: run.attemptNumber,
          status: run.status,
          errorCode: run.errorCode,
          failureClassification: run.failureClassification,
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt?.toISOString() ?? null,
        })),
      };
    }),
  };
}

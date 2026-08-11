export const REMINDER_CATEGORIES = [
  "CLIENT_REQUIREMENT",
  "PROVISIONING_MANUAL_REVIEW",
  "KICKOFF_UNSCHEDULED",
  "DELIVERY_HANDOFF_UNACKNOWLEDGED",
] as const;

export type ReminderCategory = (typeof REMINDER_CATEGORIES)[number];
export type ReminderAudience = "CLIENT" | "PROJECT_MANAGER" | "DELIVERY" | "OPERATIONS" | "ADMIN";

export type ReminderPolicyWindow = Readonly<{
  audience: ReminderAudience;
  code: string;
  thresholdHours: number;
}>;

export const REMINDER_POLICIES = {
  CLIENT_REQUIREMENT: {
    initialReminder: "DUE_SOON",
    escalationThresholdHours: 72,
    minimumIntervalHours: 48,
    maximumClientFacingReminders: 4,
    finalEscalationRecipient: "OPERATIONS",
    stopConditions: ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "ONBOARDING_CANCELLED_OR_TERMINAL"],
    windows: [
      { audience: "CLIENT", code: "DUE_SOON", thresholdHours: -48 },
      { audience: "CLIENT", code: "OVERDUE_1", thresholdHours: 24 },
      { audience: "CLIENT", code: "OVERDUE_2", thresholdHours: 72 },
      { audience: "CLIENT", code: "OVERDUE_3", thresholdHours: 120 },
      { audience: "PROJECT_MANAGER", code: "ESCALATE_PM", thresholdHours: 72 },
      { audience: "OPERATIONS", code: "FINAL_OPERATIONS", thresholdHours: 168 },
    ],
  },
  PROVISIONING_MANUAL_REVIEW: {
    initialReminder: "INITIAL_PM",
    escalationThresholdHours: 24,
    minimumIntervalHours: 20,
    maximumClientFacingReminders: 0,
    finalEscalationRecipient: "ADMIN",
    stopConditions: ["STATUS_LEAVES_MANUAL_REVIEW_REQUIRED", "ONBOARDING_CANCELLED_OR_TERMINAL"],
    windows: [
      { audience: "PROJECT_MANAGER", code: "INITIAL_PM", thresholdHours: 4 },
      { audience: "OPERATIONS", code: "ESCALATE_OPERATIONS", thresholdHours: 24 },
      { audience: "ADMIN", code: "FINAL_ADMIN", thresholdHours: 72 },
    ],
  },
  KICKOFF_UNSCHEDULED: {
    initialReminder: "INITIAL_PM",
    escalationThresholdHours: 72,
    minimumIntervalHours: 48,
    maximumClientFacingReminders: 0,
    finalEscalationRecipient: "ADMIN",
    stopConditions: ["STATUS_LEAVES_PENDING", "ONBOARDING_CANCELLED_OR_TERMINAL"],
    windows: [
      { audience: "PROJECT_MANAGER", code: "INITIAL_PM", thresholdHours: 24 },
      { audience: "OPERATIONS", code: "ESCALATE_OPERATIONS", thresholdHours: 72 },
      { audience: "ADMIN", code: "FINAL_ADMIN", thresholdHours: 168 },
    ],
  },
  DELIVERY_HANDOFF_UNACKNOWLEDGED: {
    initialReminder: "INITIAL_DELIVERY",
    escalationThresholdHours: 72,
    minimumIntervalHours: 48,
    maximumClientFacingReminders: 0,
    finalEscalationRecipient: "ADMIN",
    stopConditions: ["STATUS_LEAVES_NOTIFIED", "ONBOARDING_CANCELLED_OR_TERMINAL"],
    windows: [
      { audience: "DELIVERY", code: "INITIAL_DELIVERY", thresholdHours: 24 },
      { audience: "PROJECT_MANAGER", code: "ESCALATE_PM", thresholdHours: 72 },
      { audience: "OPERATIONS", code: "ESCALATE_OPERATIONS", thresholdHours: 120 },
      { audience: "ADMIN", code: "FINAL_ADMIN", thresholdHours: 168 },
    ],
  },
} as const satisfies Record<
  ReminderCategory,
  Readonly<{
    initialReminder: string;
    escalationThresholdHours: number;
    minimumIntervalHours: number;
    maximumClientFacingReminders: number;
    finalEscalationRecipient: ReminderAudience;
    stopConditions: readonly string[];
    windows: readonly ReminderPolicyWindow[];
  }>
>;

const TERMINAL_ONBOARDING_STATUSES = new Set(["COMPLETED", "CANCELLED", "ARCHIVED"]);
const STOPPED_REQUIREMENT_STATUSES = new Set(["SUBMITTED", "UNDER_REVIEW", "APPROVED"]);

export function reminderPolicyStopped(
  input: Readonly<{
    category: ReminderCategory;
    onboardingStatus: string;
    subjectStatus: string;
  }>,
): boolean {
  if (TERMINAL_ONBOARDING_STATUSES.has(input.onboardingStatus)) return true;
  if (input.category === "CLIENT_REQUIREMENT") {
    return STOPPED_REQUIREMENT_STATUSES.has(input.subjectStatus);
  }
  if (input.category === "PROVISIONING_MANUAL_REVIEW") {
    return input.subjectStatus !== "MANUAL_REVIEW_REQUIRED";
  }
  if (input.category === "KICKOFF_UNSCHEDULED") {
    return input.subjectStatus !== "PENDING";
  }
  return input.subjectStatus !== "NOTIFIED";
}

export function dueReminderWindows(
  input: Readonly<{
    category: ReminderCategory;
    anchorAt: Date;
    now: Date;
    onboardingStatus: string;
    subjectStatus: string;
  }>,
): readonly ReminderPolicyWindow[] {
  if (reminderPolicyStopped(input)) return [];
  const elapsedHours = (input.now.getTime() - input.anchorAt.getTime()) / 3_600_000;
  const windows = REMINDER_POLICIES[input.category].windows;
  if (input.category === "CLIENT_REQUIREMENT") {
    return windows.filter((window) =>
      window.thresholdHours < 0
        ? elapsedHours >= window.thresholdHours && elapsedHours < 0
        : elapsedHours >= window.thresholdHours,
    );
  }
  return windows.filter((window) => elapsedHours >= window.thresholdHours);
}

export function reminderKey(
  input: Readonly<{
    category: ReminderCategory;
    audience: ReminderAudience;
    aggregateId: string;
    policyWindow: string;
  }>,
): string {
  return `REMINDER:${input.audience}:${input.category}:${input.aggregateId}:${input.policyWindow}`;
}

export function reminderEventKey(notificationId: string): string {
  return `REMINDER_NOTIFICATION_REQUESTED:${notificationId}:v1`;
}

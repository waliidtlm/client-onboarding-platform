import { describe, expect, it } from "vitest";

import {
  dueReminderWindows,
  REMINDER_POLICIES,
  reminderEventKey,
  reminderKey,
  reminderPolicyStopped,
} from "@/domain/reminders/policy";

const dueAt = new Date("2026-08-10T09:00:00.000Z");

describe("bounded reminder policy", () => {
  it("defines every required policy boundary explicitly", () => {
    for (const policy of Object.values(REMINDER_POLICIES)) {
      expect(policy.windows[0]?.code).toBe(policy.initialReminder);
      expect(policy.minimumIntervalHours).toBeGreaterThan(0);
      expect(policy.escalationThresholdHours).toBeGreaterThanOrEqual(0);
      expect(policy.stopConditions.length).toBeGreaterThan(0);
      expect(policy.windows.at(-1)?.audience).toBe(policy.finalEscalationRecipient);
      expect(
        policy.windows.filter((window) => window.audience === "CLIENT").length,
      ).toBeLessThanOrEqual(policy.maximumClientFacingReminders);
    }
  });

  it("creates one pre-due and at most three overdue client windows", () => {
    const before = dueReminderWindows({
      category: "CLIENT_REQUIREMENT",
      anchorAt: dueAt,
      now: new Date("2026-08-08T10:00:00.000Z"),
      onboardingStatus: "CLIENT_AWAITING_ACTION",
      subjectStatus: "PENDING",
    });
    expect(before.map((window) => window.code)).toEqual(["DUE_SOON"]);

    const overdue = dueReminderWindows({
      category: "CLIENT_REQUIREMENT",
      anchorAt: dueAt,
      now: new Date("2026-08-20T09:00:00.000Z"),
      onboardingStatus: "CLIENT_AWAITING_ACTION",
      subjectStatus: "REJECTED",
    });
    expect(overdue.filter((window) => window.audience === "CLIENT")).toHaveLength(3);
    expect(overdue.at(-1)).toMatchObject({
      audience: "OPERATIONS",
      code: "FINAL_OPERATIONS",
    });
  });

  it.each(["SUBMITTED", "UNDER_REVIEW", "APPROVED"])(
    "stops client reminders immediately at %s",
    (subjectStatus) => {
      expect(
        reminderPolicyStopped({
          category: "CLIENT_REQUIREMENT",
          onboardingStatus: "CLIENT_AWAITING_ACTION",
          subjectStatus,
        }),
      ).toBe(true);
    },
  );

  it.each(["COMPLETED", "CANCELLED", "ARCHIVED"])(
    "stops every category for terminal onboarding %s",
    (onboardingStatus) => {
      expect(
        dueReminderWindows({
          category: "KICKOFF_UNSCHEDULED",
          anchorAt: dueAt,
          now: new Date("2026-08-20T09:00:00.000Z"),
          onboardingStatus,
          subjectStatus: "PENDING",
        }),
      ).toEqual([]);
    },
  );

  it("uses deterministic notification and event keys", () => {
    expect(
      reminderKey({
        category: "CLIENT_REQUIREMENT",
        audience: "CLIENT",
        aggregateId: "requirement-id",
        policyWindow: "OVERDUE_1",
      }),
    ).toBe("REMINDER:CLIENT:CLIENT_REQUIREMENT:requirement-id:OVERDUE_1");
    expect(reminderEventKey("notification-id")).toBe(
      "REMINDER_NOTIFICATION_REQUESTED:notification-id:v1",
    );
  });
});

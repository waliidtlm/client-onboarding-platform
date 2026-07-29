import { describe, expect, it } from "vitest";

import { canCompleteKickoff, validateKickoffDestination } from "@/domain/phase6/kickoff";
import { calculateSlaResult } from "@/domain/phase6/sla";
import { resolveScheduleInstant, validateMeetingUrl } from "@/domain/phase6/time";

describe("Phase 6 domain rules", () => {
  it("rejects nonexistent and requires a choice for ambiguous local times", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    expect(
      resolveScheduleInstant({
        localDate: "2026-03-29",
        localTime: "02:30",
        timezone: "Europe/Paris",
        now,
      }),
    ).toMatchObject({ ok: false, code: "NONEXISTENT_LOCAL_TIME" });
    expect(
      resolveScheduleInstant({
        localDate: "2026-10-25",
        localTime: "02:30",
        timezone: "Europe/Paris",
        now,
      }),
    ).toMatchObject({ ok: false, code: "AMBIGUOUS_LOCAL_TIME" });
  });

  it("accepts only safe meeting destinations", () => {
    const credentialedUrl = new URL("https://example.test");
    credentialedUrl.username = "user";
    credentialedUrl.password = "pass";
    expect(validateMeetingUrl("https://meet.example.test/room")).toBe(true);
    expect(validateMeetingUrl(credentialedUrl.toString())).toBe(false);
    expect(validateMeetingUrl("http://example.test")).toBe(false);
    expect(validateKickoffDestination(null, "Office")).toBe(true);
  });

  it("enforces timing and SLA", () => {
    const start = new Date("2026-01-01T12:00:00Z");
    expect(canCompleteKickoff(start, new Date("2026-01-01T11:44:59Z"), false, null)).toBe(false);
    expect(canCompleteKickoff(start, new Date("2026-01-01T11:45:00Z"), false, null)).toBe(true);
    expect(calculateSlaResult(new Date("2026-01-01T00:00:00Z"), start, 24)).toBe("MET");
    expect(calculateSlaResult(null, start, null)).toBe("NOT_CONFIGURED");
  });
});

import { Temporal } from "@js-temporal/polyfill";

export type AmbiguityChoice = "EARLIER" | "LATER";

export type ScheduleResolution =
  | Readonly<{ ok: true; instant: Date; ambiguous: boolean }>
  | Readonly<{
      ok: false;
      code: "INVALID_TIMEZONE" | "NONEXISTENT_LOCAL_TIME" | "AMBIGUOUS_LOCAL_TIME" | "PAST_TIME";
      message: string;
    }>;

export function resolveScheduleInstant(
  input: Readonly<{
    localDate: string;
    localTime: string;
    timezone: string;
    ambiguityChoice?: AmbiguityChoice;
    now: Date;
  }>,
): ScheduleResolution {
  if (/^(?:UTC|GMT)?[+-]\d{1,2}(?::?\d{2})?$/i.test(input.timezone.trim())) {
    return {
      ok: false,
      code: "INVALID_TIMEZONE",
      message: "Use an IANA timezone such as Europe/Paris, not a numeric offset.",
    };
  }
  try {
    const plain = Temporal.PlainDateTime.from(`${input.localDate}T${input.localTime}`);
    const earlier = plain.toZonedDateTime(input.timezone, { disambiguation: "earlier" });
    const later = plain.toZonedDateTime(input.timezone, { disambiguation: "later" });
    const earlierRoundTrip = earlier.toPlainDateTime().equals(plain);
    const laterRoundTrip = later.toPlainDateTime().equals(plain);
    if (!earlierRoundTrip && !laterRoundTrip) {
      return {
        ok: false,
        code: "NONEXISTENT_LOCAL_TIME",
        message: "That local time does not exist because the clock moves forward.",
      };
    }
    const ambiguous =
      earlierRoundTrip && laterRoundTrip && earlier.epochNanoseconds !== later.epochNanoseconds;
    if (ambiguous && !input.ambiguityChoice) {
      return {
        ok: false,
        code: "AMBIGUOUS_LOCAL_TIME",
        message: "That local time occurs twice. Choose the earlier or later occurrence.",
      };
    }
    const zoned = input.ambiguityChoice === "LATER" ? later : earlier;
    const instant = new Date(zoned.epochMilliseconds);
    if (instant.getTime() <= input.now.getTime()) {
      return { ok: false, code: "PAST_TIME", message: "Kickoff must be scheduled in the future." };
    }
    return { ok: true, instant, ambiguous };
  } catch {
    return {
      ok: false,
      code: "INVALID_TIMEZONE",
      message: "The date, time, or IANA timezone is invalid.",
    };
  }
}

export function validateMeetingUrl(value: string | null): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

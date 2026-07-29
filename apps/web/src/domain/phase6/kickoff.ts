export function validateKickoffDestination(
  meetingUrl: string | null,
  meetingLocation: string | null,
): boolean {
  return Boolean(meetingUrl?.trim() || meetingLocation?.trim());
}

export function canCompleteKickoff(
  scheduledStartAt: Date,
  now: Date,
  isAdmin: boolean,
  overrideReason: string | null,
): boolean {
  const normallyAllowed = now.getTime() >= scheduledStartAt.getTime() - 15 * 60_000;
  return normallyAllowed || (isAdmin && Boolean(overrideReason?.trim()));
}

export function validOutcomeNotes(value: string): boolean {
  const length = value.trim().length;
  return length >= 40 && length <= 5_000;
}

export type SlaResultValue = "MET" | "MISSED" | "NOT_CONFIGURED";

export function calculateSlaResult(
  activatedAt: Date | null,
  completedAt: Date,
  targetHours: number | null,
): SlaResultValue {
  if (!activatedAt || targetHours === null) return "NOT_CONFIGURED";
  return completedAt.getTime() <= activatedAt.getTime() + targetHours * 3_600_000
    ? "MET"
    : "MISSED";
}

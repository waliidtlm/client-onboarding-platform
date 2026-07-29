import { phase6Fingerprint } from "@/domain/phase6/idempotency";

export const HANDOFF_SUMMARY_SCHEMA_VERSION = 1;
const MAX_SNAPSHOT_BYTES = 32_000;

export function buildHandoffSnapshot(
  input: Readonly<{
    onboardingId: string;
    clientName: string;
    packageName: string;
    projectManagerName: string;
    kickoffOutcomeNotes: string;
    approvedRequirements: readonly Readonly<{
      requirementId: string;
      title: string;
      responseText: string | null;
      fileNames: readonly string[];
    }>[];
  }>,
): Readonly<{ snapshot: Record<string, unknown>; fingerprint: string }> {
  const snapshot = {
    schemaVersion: HANDOFF_SUMMARY_SCHEMA_VERSION,
    onboardingId: input.onboardingId,
    clientName: input.clientName.slice(0, 200),
    packageName: input.packageName.slice(0, 200),
    projectManagerName: input.projectManagerName.slice(0, 200),
    kickoffOutcomeNotes: input.kickoffOutcomeNotes.slice(0, 5_000),
    approvedRequirements: input.approvedRequirements.slice(0, 100).map((requirement) => ({
      requirementId: requirement.requirementId,
      title: requirement.title.slice(0, 300),
      responseText: requirement.responseText?.slice(0, 5_000) ?? null,
      fileNames: requirement.fileNames.slice(0, 20).map((name) => name.slice(0, 255)),
    })),
  };
  const serialized = JSON.stringify(snapshot);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SNAPSHOT_BYTES) {
    throw new Error("HANDOFF_SNAPSHOT_TOO_LARGE");
  }
  return { snapshot, fingerprint: phase6Fingerprint(snapshot) };
}

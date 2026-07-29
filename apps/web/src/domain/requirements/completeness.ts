import type { ClientRequirementStatus } from "@/generated/prisma/client";

export type RequirementCompletenessInput = Readonly<{
  id: string;
  name: string;
  isRequired: boolean;
  status: ClientRequirementStatus;
}>;

export type RequirementCompleteness = Readonly<{
  complete: boolean;
  mandatoryCount: number;
  approvedMandatoryCount: number;
  blockers: readonly Readonly<{
    requirementId: string;
    name: string;
    status: ClientRequirementStatus;
  }>[];
  optionalWarnings: readonly Readonly<{
    requirementId: string;
    name: string;
    status: ClientRequirementStatus;
  }>[];
  configurationError: "NO_MANDATORY_REQUIREMENTS" | null;
}>;

export function calculateRequirementCompleteness(
  requirements: readonly RequirementCompletenessInput[],
): RequirementCompleteness {
  const mandatory = requirements.filter((requirement) => requirement.isRequired);
  const optionalWarnings = requirements
    .filter((requirement) => !requirement.isRequired && requirement.status !== "APPROVED")
    .map(({ id: requirementId, name, status }) => ({ requirementId, name, status }));
  const blockers = mandatory
    .filter((requirement) => requirement.status !== "APPROVED")
    .map(({ id: requirementId, name, status }) => ({ requirementId, name, status }));
  const approvedMandatoryCount = mandatory.length - blockers.length;

  return {
    complete: mandatory.length > 0 && blockers.length === 0,
    mandatoryCount: mandatory.length,
    approvedMandatoryCount,
    blockers,
    optionalWarnings,
    configurationError: mandatory.length === 0 ? "NO_MANDATORY_REQUIREMENTS" : null,
  };
}

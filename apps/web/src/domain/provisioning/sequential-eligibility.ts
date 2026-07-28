import type { ProvisioningTaskStatus } from "@/generated/prisma/client";

export type SequencedTask = Readonly<{
  id: string;
  sequence: number;
  isRequired: boolean;
  status: ProvisioningTaskStatus;
}>;

function earlierOutcomeAllowsSequence(task: SequencedTask): boolean {
  if (task.status === "COMPLETED" || task.status === "MANUALLY_ACCEPTED") return true;
  return !task.isRequired && task.status === "MANUAL_REVIEW_REQUIRED";
}

export function findNextEligibleProvisioningTask(
  tasks: readonly SequencedTask[],
): SequencedTask | null {
  const ordered = [...tasks].sort(
    (left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id),
  );
  if (ordered.some((task) => task.status === "IN_PROGRESS")) return null;

  for (let index = 0; index < ordered.length; index += 1) {
    const task = ordered[index]!;
    if (task.status !== "PENDING" && task.status !== "FAILED") continue;
    if (ordered.slice(0, index).every(earlierOutcomeAllowsSequence)) return task;
    return null;
  }
  return null;
}

export function canStartProvisioningTask(taskId: string, tasks: readonly SequencedTask[]): boolean {
  return findNextEligibleProvisioningTask(tasks)?.id === taskId;
}

import type { ProvisioningTaskStatus } from "@/generated/prisma/client";

export type ReadinessTask = Readonly<{
  id: string;
  isRequired: boolean;
  status: ProvisioningTaskStatus;
}>;

export type ProvisioningReadinessBlocker = Readonly<{
  taskId: string | null;
  status: ProvisioningTaskStatus | null;
  reason:
    | "NO_REQUIRED_TASKS_CONFIGURED"
    | "REQUIRED_TASK_PENDING"
    | "REQUIRED_TASK_IN_PROGRESS"
    | "REQUIRED_TASK_FAILED"
    | "REQUIRED_TASK_MANUAL_REVIEW";
}>;

export type ProvisioningReadiness = Readonly<{
  ready: boolean;
  requiredTaskCount: number;
  blockers: readonly ProvisioningReadinessBlocker[];
  optionalWarnings: readonly Readonly<{
    taskId: string;
    status: ProvisioningTaskStatus;
  }>[];
}>;

export function calculateProvisioningReadiness(
  tasks: readonly ReadinessTask[],
): ProvisioningReadiness {
  const required = tasks.filter((task) => task.isRequired);
  if (required.length === 0) {
    return {
      ready: false,
      requiredTaskCount: 0,
      blockers: [{ taskId: null, status: null, reason: "NO_REQUIRED_TASKS_CONFIGURED" }],
      optionalWarnings: tasks
        .filter((task) => task.status === "MANUAL_REVIEW_REQUIRED")
        .map((task) => ({ taskId: task.id, status: task.status })),
    };
  }

  const blockers = required.flatMap((task): ProvisioningReadinessBlocker[] => {
    if (task.status === "COMPLETED" || task.status === "MANUALLY_ACCEPTED") return [];
    const reason =
      task.status === "PENDING"
        ? "REQUIRED_TASK_PENDING"
        : task.status === "IN_PROGRESS"
          ? "REQUIRED_TASK_IN_PROGRESS"
          : task.status === "MANUAL_REVIEW_REQUIRED"
            ? "REQUIRED_TASK_MANUAL_REVIEW"
            : "REQUIRED_TASK_FAILED";
    return [{ taskId: task.id, status: task.status, reason }];
  });

  return {
    ready: blockers.length === 0,
    requiredTaskCount: required.length,
    blockers,
    optionalWarnings: tasks
      .filter((task) => !task.isRequired && task.status === "MANUAL_REVIEW_REQUIRED")
      .map((task) => ({ taskId: task.id, status: task.status })),
  };
}

export function mayEnterInternalReview(tasks: readonly ReadinessTask[]): boolean {
  const readiness = calculateProvisioningReadiness(tasks);
  if (!readiness.ready) return false;
  return tasks.every(
    (task) =>
      task.status === "COMPLETED" ||
      task.status === "MANUALLY_ACCEPTED" ||
      (!task.isRequired && task.status === "MANUAL_REVIEW_REQUIRED"),
  );
}

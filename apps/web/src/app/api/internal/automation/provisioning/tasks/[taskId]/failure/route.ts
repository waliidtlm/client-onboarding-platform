import { failProvisioningTaskSchema } from "@/application/provisioning/contracts";
import { failProvisioningTask } from "@/application/provisioning/task-lifecycle-service";
import { handlePhase4MachinePost } from "@/lib/automation/phase4-route";

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await context.params;
  return handlePhase4MachinePost(request, failProvisioningTaskSchema, (input) =>
    input.taskId === taskId
      ? failProvisioningTask(input)
      : Promise.resolve({
          ok: false as const,
          error: { code: "EVENT_BINDING_CONFLICT" as const, message: "Task identifiers conflict." },
        }),
  );
}

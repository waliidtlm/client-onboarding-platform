import { initializeProvisioningSchema } from "@/application/provisioning/contracts";
import { generatePackageTasks } from "@/application/provisioning/task-generation-service";
import { handlePhase4MachinePost } from "@/lib/automation/phase4-route";

export async function POST(request: Request): Promise<Response> {
  return handlePhase4MachinePost(request, initializeProvisioningSchema, generatePackageTasks);
}

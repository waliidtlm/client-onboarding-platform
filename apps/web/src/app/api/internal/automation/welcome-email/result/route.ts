import { recordWelcomeDeliverySchema } from "@/application/provisioning/contracts";
import { recordWelcomeEmailResult } from "@/application/notifications/welcome-email-service";
import { handlePhase4MachinePost } from "@/lib/automation/phase4-route";

export async function POST(request: Request): Promise<Response> {
  return handlePhase4MachinePost(request, recordWelcomeDeliverySchema, recordWelcomeEmailResult);
}

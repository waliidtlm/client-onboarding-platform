import { deliverReminderSchema } from "@/application/reminders/contracts";
import { deliverReminderNotification } from "@/application/reminders/delivery-service";
import { parseJsonBody } from "@/lib/automation/raw-request";
import {
  authenticateAutomationRequest,
  automationResultResponse,
} from "@/lib/automation/transport";

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticateAutomationRequest(request, ["PHASE7_REMINDERS"]);
  if (!authenticated.ok) return authenticated.response;
  let raw: unknown;
  try {
    raw = parseJsonBody(authenticated.rawBody);
  } catch {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "Invalid request." } },
      { status: 400 },
    );
  }
  const parsed = deliverReminderSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "Invalid request." } },
      { status: 400 },
    );
  }
  return automationResultResponse(await deliverReminderNotification(parsed.data));
}

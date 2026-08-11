import { evaluateRemindersSchema } from "@/application/reminders/contracts";
import { evaluateDueReminders } from "@/application/reminders/evaluation-service";
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
  const parsed = evaluateRemindersSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "Invalid request." } },
      { status: 400 },
    );
  }
  return automationResultResponse(await evaluateDueReminders(parsed.data));
}

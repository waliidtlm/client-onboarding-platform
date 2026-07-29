import { machinePhase6RunSchema } from "@/application/phase6/contracts";
import { initializeKickoffFromCompletionEvent } from "@/application/phase6/kickoff-service";
import { parseJsonBody } from "@/lib/automation/raw-request";
import {
  authenticateAutomationRequest,
  automationResultResponse,
} from "@/lib/automation/transport";

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticateAutomationRequest(request, ["PHASE6_HANDOFF"]);
  if (!authenticated.ok) return authenticated.response;
  let raw: unknown;
  try {
    raw = parseJsonBody(authenticated.rawBody);
  } catch {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "Invalid JSON." } },
      { status: 400 },
    );
  }
  const parsed = machinePhase6RunSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "Invalid request." } },
      { status: 400 },
    );
  }
  return automationResultResponse(await initializeKickoffFromCompletionEvent(parsed.data));
}

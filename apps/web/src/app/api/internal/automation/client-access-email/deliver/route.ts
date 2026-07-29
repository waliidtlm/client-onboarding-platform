import { deliverClientAccessEmail } from "@/application/client-access/access-email-service";
import { deliverClientAccessEmailSchema } from "@/application/provisioning/contracts";
import { parseJsonBody } from "@/lib/automation/raw-request";
import {
  authenticateAutomationRequest,
  automationResultResponse,
} from "@/lib/automation/transport";

export async function POST(request: Request): Promise<Response> {
  const authenticated = await authenticateAutomationRequest(request, ["PHASE5_ACCESS_EMAIL"]);
  if (!authenticated.ok) return authenticated.response;
  let raw: unknown;
  try {
    raw = parseJsonBody(authenticated.rawBody);
  } catch {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "The request body is invalid." } },
      { status: 400 },
    );
  }
  const input = deliverClientAccessEmailSchema.safeParse(raw);
  if (!input.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "The request body is invalid." } },
      { status: 400 },
    );
  }
  return automationResultResponse(await deliverClientAccessEmail(input.data));
}

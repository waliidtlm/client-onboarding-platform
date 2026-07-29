import { claimAutomationSchema } from "@/application/automation/contracts";
import { claimAutomationEvent } from "@/application/automation/claim-service";
import { parseJsonBody } from "@/lib/automation/raw-request";
import {
  authenticateAutomationRequest,
  automationResultResponse,
} from "@/lib/automation/transport";
import { logger } from "@/lib/logger";

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const authenticated = await authenticateAutomationRequest(request);
  if (!authenticated.ok) return authenticated.response;
  let parsed: unknown;
  try {
    parsed = parseJsonBody(authenticated.rawBody);
  } catch {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "The request body is invalid." } },
      { status: 400 },
    );
  }
  const input = claimAutomationSchema.safeParse(parsed);
  if (!input.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "The request body is invalid." } },
      { status: 400 },
    );
  }
  const result = await claimAutomationEvent(
    input.data,
    undefined,
    authenticated.authorizedEventTypes,
  );
  logger.info({
    requestId: input.data.requestId,
    action: "AUTOMATION_CLAIM",
    durationMs: Date.now() - startedAt,
    outcome: result.ok ? result.value.kind : result.error.code,
  });
  if (result.ok && result.value.kind === "EMPTY") {
    return new Response(null, { status: 204 });
  }
  return automationResultResponse(result);
}

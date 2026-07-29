import { randomUUID } from "node:crypto";

import { automationContextAccessSchema } from "@/application/automation/contracts";
import { loadAutomationContext } from "@/application/automation/context-service";
import {
  authenticateAutomationRequest,
  automationResultResponse,
} from "@/lib/automation/transport";
import { logger } from "@/lib/logger";

export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const authenticated = await authenticateAutomationRequest(request, ["PHASE4_PROVISIONING"]);
  if (!authenticated.ok) return authenticated.response;
  if (authenticated.rawBody.byteLength !== 0) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "GET requests must not contain a body." } },
      { status: 400 },
    );
  }
  const { eventId } = await context.params;
  const url = new URL(request.url);
  const access = automationContextAccessSchema.safeParse({
    runId: url.searchParams.get("runId"),
    idempotencyKey: url.searchParams.get("idempotencyKey"),
    workerId: url.searchParams.get("workerId"),
  });
  if (!access.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "The context request is invalid." } },
      { status: 400 },
    );
  }
  const result = await loadAutomationContext(eventId, access.data);
  logger.info({
    requestId,
    eventId,
    automationRunId: access.data.runId,
    action: "AUTOMATION_CONTEXT",
    durationMs: Date.now() - startedAt,
    outcome: result.ok ? "AUTHORIZED" : result.error.code,
  });
  return automationResultResponse(result);
}

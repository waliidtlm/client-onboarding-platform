import { randomUUID } from "node:crypto";

import { automationCallbackSchema } from "@/application/automation/contracts";
import { completeAutomationRun } from "@/application/automation/callback-service";
import { parseJsonBody } from "@/lib/automation/raw-request";
import {
  authenticateAutomationRequest,
  automationResultResponse,
} from "@/lib/automation/transport";
import { logger } from "@/lib/logger";

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = randomUUID();
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
  const input = automationCallbackSchema.safeParse(parsed);
  if (!input.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "The request body is invalid." } },
      { status: 400 },
    );
  }
  const result = await completeAutomationRun(input.data);
  logger.info({
    requestId,
    eventId: input.data.eventId,
    automationRunId: input.data.runId,
    n8nExecutionId: input.data.n8nExecutionId,
    action: "AUTOMATION_CALLBACK",
    durationMs: Date.now() - startedAt,
    outcome: result.ok ? result.value.status : result.error.code,
  });
  return automationResultResponse(result);
}

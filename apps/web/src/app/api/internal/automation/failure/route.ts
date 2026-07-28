import { randomUUID } from "node:crypto";

import { automationFailureSchema } from "@/application/automation/contracts";
import { failAutomationRun } from "@/application/automation/failure-service";
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
  const input = automationFailureSchema.safeParse(parsed);
  if (!input.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "The request body is invalid." } },
      { status: 400 },
    );
  }
  const result = await failAutomationRun(input.data);
  logger.warn({
    requestId,
    eventId: input.data.eventId,
    automationRunId: input.data.runId,
    n8nExecutionId: input.data.n8nExecutionId,
    action: "AUTOMATION_FAILURE",
    errorCode: input.data.errorCode,
    durationMs: Date.now() - startedAt,
    outcome: result.ok ? result.value.status : result.error.code,
  });
  return automationResultResponse(result);
}

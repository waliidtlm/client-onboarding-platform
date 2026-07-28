import type { z } from "zod";
import { parseJsonBody } from "@/lib/automation/raw-request";
import {
  authenticateAutomationRequest,
  automationResultResponse,
} from "@/lib/automation/transport";

export async function handlePhase4MachinePost<T>(
  request: Request,
  schema: z.ZodType<T>,
  work: (input: T) => Promise<Parameters<typeof automationResultResponse>[0]>,
): Promise<Response> {
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
  const input = schema.safeParse(parsed);
  if (!input.success) {
    return Response.json(
      { error: { code: "INVALID_INPUT", message: "The request body is invalid." } },
      { status: 400 },
    );
  }
  return automationResultResponse(await work(input.data));
}

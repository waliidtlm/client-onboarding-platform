import { randomUUID } from "node:crypto";

import { submitClientRequirement } from "@/application/requirements/submission-service";
import { readLimitedJson } from "@/lib/client-access/public-security";
import {
  authorizeClientRequest,
  publicResult,
  publicServiceUnavailable,
} from "@/lib/client-access/public-route";

export async function POST(
  request: Request,
  context: { params: Promise<{ requirementId: string }> },
): Promise<Response> {
  try {
    const authorized = await authorizeClientRequest(request, { mutation: true });
    if (!authorized.ok) return authorized.response;
    const { requirementId } = await context.params;
    const body = (await readLimitedJson(request)) as Record<string, unknown>;
    return publicResult(
      await submitClientRequirement({
        ...body,
        requirementId,
        tokenId: authorized.access.tokenId,
        onboardingId: authorized.access.onboardingId,
        correlationId: randomUUID(),
      }),
      201,
    );
  } catch {
    return publicServiceUnavailable();
  }
}

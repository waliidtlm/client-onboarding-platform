import type { DomainError, Result } from "@/domain/errors";
import { getServerEnvironment } from "@/lib/env";
import { readRawRequestBody, RequestBodyTooLargeError } from "@/lib/automation/raw-request";
import { verifyAutomationAuthentication } from "@/lib/automation/service-auth";

export type AuthenticatedAutomationRequest =
  | Readonly<{
      ok: true;
      rawBody: Uint8Array;
      serviceIdentity: AutomationServiceIdentity;
      authorizedEventTypes: readonly string[];
    }>
  | Readonly<{ ok: false; response: Response }>;

export type AutomationServiceIdentity =
  "PHASE4_PROVISIONING" | "PHASE5_ACCESS_EMAIL" | "PHASE6_HANDOFF";

const identityCapabilities = {
  PHASE4_PROVISIONING: [
    "ONBOARDING_ACTIVATED",
    "PROVISIONING_TASK_REQUESTED",
    "WELCOME_EMAIL_REQUESTED",
  ],
  PHASE5_ACCESS_EMAIL: ["CLIENT_ACCESS_EMAIL_REQUESTED"],
  PHASE6_HANDOFF: [
    "CLIENT_REQUIREMENTS_COMPLETED",
    "KICKOFF_INVITATION_REQUESTED",
    "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED",
    "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED",
  ],
} as const satisfies Record<AutomationServiceIdentity, readonly string[]>;

export async function authenticateAutomationRequest(
  request: Request,
  allowedIdentities?: readonly AutomationServiceIdentity[],
): Promise<AuthenticatedAutomationRequest> {
  let rawBody: Uint8Array;
  try {
    rawBody = await readRawRequestBody(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return {
        ok: false,
        response: Response.json(
          { error: { code: "REQUEST_TOO_LARGE", message: "Request is too large." } },
          { status: 413 },
        ),
      };
    }
    throw error;
  }
  const environment = getServerEnvironment();
  const url = new URL(request.url);
  const credentials: ReadonlyArray<readonly [AutomationServiceIdentity, string, string]> = [
    [
      "PHASE4_PROVISIONING",
      environment.AUTOMATION_SERVICE_TOKEN,
      environment.AUTOMATION_HMAC_SECRET,
    ],
    [
      "PHASE5_ACCESS_EMAIL",
      environment.AUTOMATION_PHASE5_SERVICE_TOKEN,
      environment.AUTOMATION_PHASE5_HMAC_SECRET,
    ],
    [
      "PHASE6_HANDOFF",
      environment.AUTOMATION_PHASE6_SERVICE_TOKEN,
      environment.AUTOMATION_PHASE6_HMAC_SECRET,
    ],
  ];
  const serviceIdentity = credentials.find(([identity, serviceToken, hmacSecret]) => {
    if (allowedIdentities && !allowedIdentities.includes(identity)) return false;
    return verifyAutomationAuthentication({
      authorization: request.headers.get("authorization"),
      signature: request.headers.get("x-automation-signature"),
      timestamp: request.headers.get("x-automation-timestamp"),
      method: request.method,
      requestTarget: `${url.pathname}${url.search}`,
      rawBody,
      serviceToken,
      hmacSecret,
      maxAgeSeconds: environment.AUTOMATION_SIGNATURE_MAX_AGE_SECONDS,
    });
  })?.[0];
  if (!serviceIdentity) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication failed." } },
        { status: 401 },
      ),
    };
  }
  return {
    ok: true,
    rawBody,
    serviceIdentity,
    authorizedEventTypes: identityCapabilities[serviceIdentity],
  };
}

function errorStatus(error: DomainError): number {
  if (error.code === "NOT_FOUND") return 404;
  if (
    error.code.includes("CONFLICT") ||
    error.code === "INVALID_TRANSITION" ||
    error.code === "LEASE_EXPIRED" ||
    error.code === "AUTOMATION_CONTEXT_DENIED"
  ) {
    return 409;
  }
  if (
    error.code === "INVALID_EVENT_SCHEMA" ||
    error.code === "UNSUPPORTED_EVENT_TYPE" ||
    error.code === "INVALID_EVENT_INTEGRITY"
  ) {
    return 422;
  }
  if (error.code === "ACCESS_DENIED") return 403;
  return 400;
}

export function automationResultResponse<T>(result: Result<T>, successStatus = 200): Response {
  if (result.ok) return Response.json(result.value, { status: successStatus });
  return Response.json({ error: result.error }, { status: errorStatus(result.error) });
}

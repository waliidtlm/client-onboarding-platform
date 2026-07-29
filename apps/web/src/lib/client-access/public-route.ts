import {
  consumeRateLimit,
  type RateLimitScope,
} from "@/application/client-access/rate-limit-service";
import {
  CLIENT_SESSION_COOKIE,
  validateClientSession,
  type ValidClientAccess,
} from "@/application/client-access/session-service";
import type { DomainError, Result } from "@/domain/errors";
import {
  genericAccessDenied,
  publicJson,
  verifyPublicMutationRequest,
} from "@/lib/client-access/public-security";

export const CLIENT_CSRF_COOKIE = "northstar_client_csrf";

export function cookieValue(request: Request, name: string): string | undefined {
  const entry = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : undefined;
}

export function clientCookie(
  name: string,
  value: string,
  input: { httpOnly: boolean; maxAge: number },
): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/client-access; Max-Age=${input.maxAge}; SameSite=Strict${secure}${input.httpOnly ? "; HttpOnly" : ""}`;
}

export async function authorizeClientRequest(
  request: Request,
  options: {
    mutation: boolean;
    extraRateScope?: RateLimitScope;
  },
): Promise<
  Readonly<{ ok: true; access: ValidClientAccess }> | Readonly<{ ok: false; response: Response }>
> {
  if (options.mutation) {
    const rejected = verifyPublicMutationRequest(request);
    if (rejected) return { ok: false, response: rejected };
  }
  const access = await validateClientSession(
    cookieValue(request, CLIENT_SESSION_COOKIE),
    request.headers.get("x-csrf-token"),
    options.mutation,
  );
  if (!access) return { ok: false, response: genericAccessDenied() };
  if (options.mutation) {
    const general = await consumeRateLimit("PUBLIC_MUTATION_SESSION", access.sessionId);
    if (!general.allowed) {
      return {
        ok: false,
        response: publicJson(
          { error: { code: "RATE_LIMITED", message: "Please wait before trying again." } },
          {
            status: 429,
            headers: { "Retry-After": String(general.retryAfterSeconds) },
          },
        ),
      };
    }
    if (options.extraRateScope) {
      const extra = await consumeRateLimit(options.extraRateScope, access.sessionId);
      if (!extra.allowed) {
        return {
          ok: false,
          response: publicJson(
            { error: { code: "RATE_LIMITED", message: "Please wait before uploading again." } },
            {
              status: 429,
              headers: { "Retry-After": String(extra.retryAfterSeconds) },
            },
          ),
        };
      }
    }
  }
  return { ok: true, access };
}

function publicErrorStatus(error: DomainError): number {
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "ACCESS_DENIED" || error.code === "CLIENT_ACCESS_INVALID") return 401;
  if (error.code === "FILE_UPLOAD_EXPIRED") return 410;
  if (error.code.includes("CONFLICT") || error.code === "INVALID_TRANSITION") return 409;
  return 400;
}

export function publicResult<T>(result: Result<T>, successStatus = 200): Response {
  if (result.ok) return publicJson(result.value, { status: successStatus });
  if (result.error.code === "CLIENT_ACCESS_INVALID") return genericAccessDenied();
  return publicJson(
    { error: { code: result.error.code, message: result.error.message } },
    { status: publicErrorStatus(result.error) },
  );
}

export function publicServiceUnavailable(): Response {
  return publicJson(
    { error: { code: "SERVICE_UNAVAILABLE", message: "Please try again later." } },
    { status: 503 },
  );
}

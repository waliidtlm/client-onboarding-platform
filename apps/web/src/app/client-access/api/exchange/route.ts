import { z } from "zod";

import {
  normalizeClientIp,
  consumeRateLimit,
} from "@/application/client-access/rate-limit-service";
import {
  CLIENT_SESSION_COOKIE,
  exchangeClientCapability,
} from "@/application/client-access/session-service";
import {
  publicJson,
  readLimitedJson,
  verifyPublicMutationRequest,
} from "@/lib/client-access/public-security";
import {
  CLIENT_CSRF_COOKIE,
  clientCookie,
  publicServiceUnavailable,
} from "@/lib/client-access/public-route";

const exchangeSchema = z.object({ token: z.string().min(1).max(300) }).strict();

export async function POST(request: Request): Promise<Response> {
  const rejected = verifyPublicMutationRequest(request);
  if (rejected) return rejected;
  try {
    const ipLimit = await consumeRateLimit("TOKEN_EXCHANGE_IP", normalizeClientIp(request));
    if (!ipLimit.allowed) {
      return publicJson(
        { error: { code: "RATE_LIMITED", message: "Please wait before trying again." } },
        {
          status: 429,
          headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
        },
      );
    }
    const parsed = exchangeSchema.safeParse(await readLimitedJson(request, 1_024));
    if (!parsed.success) {
      return publicJson(
        { error: { code: "CLIENT_ACCESS_INVALID", message: "Secure access is unavailable." } },
        { status: 401 },
      );
    }
    const exchanged = await exchangeClientCapability(parsed.data.token);
    if (!exchanged) {
      return publicJson(
        { error: { code: "CLIENT_ACCESS_INVALID", message: "Secure access is unavailable." } },
        { status: 401 },
      );
    }
    if (exchanged.rateLimited) {
      return publicJson(
        { error: { code: "RATE_LIMITED", message: "Please wait before trying again." } },
        {
          status: 429,
          headers: { "Retry-After": String(exchanged.retryAfterSeconds) },
        },
      );
    }
    const response = publicJson({ ok: true });
    response.headers.append(
      "Set-Cookie",
      clientCookie(CLIENT_SESSION_COOKIE, exchanged.cookieValue, {
        httpOnly: true,
        maxAge: Math.max(1, Math.floor((exchanged.expiresAt.getTime() - Date.now()) / 1_000)),
      }),
    );
    response.headers.append(
      "Set-Cookie",
      clientCookie(CLIENT_CSRF_COOKIE, exchanged.csrfToken, {
        httpOnly: false,
        maxAge: Math.max(1, Math.floor((exchanged.expiresAt.getTime() - Date.now()) / 1_000)),
      }),
    );
    return response;
  } catch {
    return publicServiceUnavailable();
  }
}

import {
  consumeRateLimit,
  normalizeClientIp,
} from "@/application/client-access/rate-limit-service";

const GENERIC_MESSAGE = "The email or password is invalid, or this account is unavailable.";

function denied(retryAfterSeconds?: number): Response {
  return Response.json(
    { error: "CredentialsSignin", message: GENERIC_MESSAGE },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        ...(retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {}),
      },
    },
  );
}

export async function enforceStaffSignInRateLimit(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.endsWith("/api/auth/callback/credentials")) return null;
  try {
    const form = await request.clone().formData();
    const rawEmail = form.get("email");
    const normalizedEmail =
      typeof rawEmail === "string" ? rawEmail.trim().toLowerCase().slice(0, 320) : "";
    const ip = normalizeClientIp(request);
    const [ipLimit, accountLimit] = await Promise.all([
      consumeRateLimit("STAFF_LOGIN_IP", ip),
      consumeRateLimit("STAFF_LOGIN_ACCOUNT", normalizedEmail || "invalid-account-identifier"),
    ]);
    if (!ipLimit.allowed || !accountLimit.allowed) {
      return denied(Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds));
    }
    return null;
  } catch {
    return denied();
  }
}

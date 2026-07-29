import { getServerEnvironment } from "@/lib/env";

export function clientAccessSigningKey(version: number): Buffer | null {
  const encoded = getServerEnvironment().CLIENT_ACCESS_SIGNING_KEYS[String(version)];
  return encoded ? Buffer.from(encoded, "base64url") : null;
}

export function activeClientAccessSigningKey(): Readonly<{ version: number; key: Buffer }> {
  const environment = getServerEnvironment();
  const version = environment.CLIENT_ACCESS_ACTIVE_SIGNING_KEY_VERSION;
  const key = clientAccessSigningKey(version);
  if (!key || key.length < 32) {
    throw new Error("CLIENT_ACCESS_SIGNING_KEY_UNAVAILABLE");
  }
  return { version, key };
}

export function clientSessionSecret(): Buffer {
  return Buffer.from(getServerEnvironment().CLIENT_SESSION_SECRET, "base64url");
}

export function rateLimitSecret(): Buffer {
  return Buffer.from(getServerEnvironment().PUBLIC_RATE_LIMIT_HMAC_SECRET, "base64url");
}

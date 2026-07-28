import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type CanonicalRequestInput = Readonly<{
  method: string;
  requestTarget: string;
  timestamp: string;
  rawBody: Uint8Array;
}>;

export function sha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalAutomationRequest(input: CanonicalRequestInput): string {
  return [
    input.method.toUpperCase(),
    input.requestTarget,
    input.timestamp,
    sha256Hex(input.rawBody),
  ].join("\n");
}

export function signAutomationRequest(input: CanonicalRequestInput, secret: string): string {
  return `sha256=${createHmac("sha256", secret)
    .update(canonicalAutomationRequest(input))
    .digest("hex")}`;
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function verifyAutomationAuthentication(
  input: Readonly<{
    authorization: string | null;
    signature: string | null;
    timestamp: string | null;
    method: string;
    requestTarget: string;
    rawBody: Uint8Array;
    serviceToken: string;
    hmacSecret: string;
    maxAgeSeconds: number;
    now?: Date;
  }>,
): boolean {
  if (
    !input.authorization?.startsWith("Bearer ") ||
    !input.timestamp ||
    !input.signature ||
    !/^sha256=[a-f0-9]{64}$/.test(input.signature) ||
    !/^\d{10}$/.test(input.timestamp)
  ) {
    return false;
  }
  const token = input.authorization.slice("Bearer ".length);
  if (!constantTimeTextEqual(token, input.serviceToken)) {
    return false;
  }
  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > input.maxAgeSeconds
  ) {
    return false;
  }
  const expected = signAutomationRequest(
    {
      method: input.method,
      requestTarget: input.requestTarget,
      timestamp: input.timestamp,
      rawBody: input.rawBody,
    },
    input.hmacSecret,
  );
  return constantTimeTextEqual(input.signature, expected);
}

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 1;
const BASE64URL_256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export type TokenRecordMaterial = Readonly<{
  id: string;
  tokenHash: string;
  tokenNonce: string;
  tokenVersion: number;
  signingKeyVersion: number;
  expiresAt: Date;
}>;

export type CreatedCapabilityToken = Readonly<{
  rawToken: string;
  tokenHash: string;
  tokenNonce: string;
  tokenVersion: number;
  signingKeyVersion: number;
}>;

function unsignedToken(input: {
  id: string;
  nonce: string;
  expiresAt: Date;
  tokenVersion: number;
  signingKeyVersion: number;
}): string {
  return [
    `v${input.tokenVersion}`,
    `k${input.signingKeyVersion}`,
    input.id.toLowerCase(),
    input.nonce,
    Math.floor(input.expiresAt.getTime() / 1000).toString(),
  ].join(".");
}

export function createCapabilityToken(input: {
  tokenId: string;
  expiresAt: Date;
  signingKeyVersion: number;
  signingKey: Buffer;
}): CreatedCapabilityToken {
  const tokenNonce = randomBytes(32).toString("base64url");
  const unsigned = unsignedToken({
    id: input.tokenId,
    nonce: tokenNonce,
    expiresAt: input.expiresAt,
    tokenVersion: TOKEN_VERSION,
    signingKeyVersion: input.signingKeyVersion,
  });
  const signature = base64url(createHmac("sha256", input.signingKey).update(unsigned).digest());
  const rawToken = `${unsigned}.${signature}`;
  return {
    rawToken,
    tokenHash: createHash("sha256").update(rawToken).digest("hex"),
    tokenNonce,
    tokenVersion: TOKEN_VERSION,
    signingKeyVersion: input.signingKeyVersion,
  };
}

export function reconstructCapabilityToken(
  record: TokenRecordMaterial,
  signingKey: Buffer,
): string {
  const unsigned = unsignedToken({
    id: record.id,
    nonce: record.tokenNonce,
    expiresAt: record.expiresAt,
    tokenVersion: record.tokenVersion,
    signingKeyVersion: record.signingKeyVersion,
  });
  const signature = base64url(createHmac("sha256", signingKey).update(unsigned).digest());
  return `${unsigned}.${signature}`;
}

export type ParsedCapabilityToken = Readonly<{
  tokenId: string;
  tokenVersion: number;
  signingKeyVersion: number;
  nonce: string;
  expiresAtSeconds: number;
  signature: string;
}>;

export function parseCapabilityToken(rawToken: string): ParsedCapabilityToken | null {
  if (rawToken.length > 300) return null;
  const parts = rawToken.split(".");
  if (parts.length !== 6) return null;
  const [versionPart, keyPart, tokenId, nonce, expirationPart, signature] = parts;
  if (
    versionPart !== `v${TOKEN_VERSION}` ||
    !/^k[1-9][0-9]*$/.test(keyPart!) ||
    !UUID_PATTERN.test(tokenId!) ||
    !BASE64URL_256_PATTERN.test(nonce!) ||
    !/^[1-9][0-9]{9,10}$/.test(expirationPart!) ||
    !BASE64URL_256_PATTERN.test(signature!)
  ) {
    return null;
  }
  return {
    tokenId: tokenId!.toLowerCase(),
    tokenVersion: TOKEN_VERSION,
    signingKeyVersion: Number(keyPart!.slice(1)),
    nonce: nonce!,
    expiresAtSeconds: Number(expirationPart),
    signature: signature!,
  };
}

export function verifyCapabilityToken(
  rawToken: string,
  parsed: ParsedCapabilityToken,
  record: TokenRecordMaterial,
  signingKey: Buffer,
): boolean {
  if (
    parsed.tokenId !== record.id.toLowerCase() ||
    parsed.tokenVersion !== record.tokenVersion ||
    parsed.signingKeyVersion !== record.signingKeyVersion ||
    parsed.nonce !== record.tokenNonce ||
    parsed.expiresAtSeconds !== Math.floor(record.expiresAt.getTime() / 1000)
  ) {
    return false;
  }
  const expected = reconstructCapabilityToken(record, signingKey);
  const expectedParts = expected.split(".");
  const expectedSignature = Buffer.from(expectedParts[5]!, "base64url");
  const suppliedSignature = Buffer.from(parsed.signature, "base64url");
  const expectedHash = Buffer.from(record.tokenHash, "hex");
  const suppliedHash = createHash("sha256").update(rawToken).digest();
  return (
    safeEqual(expectedSignature, suppliedSignature) &&
    safeEqual(expectedHash, suppliedHash) &&
    safeEqual(Buffer.from(expected), Buffer.from(rawToken))
  );
}

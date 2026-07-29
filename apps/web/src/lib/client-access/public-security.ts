import { getServerEnvironment } from "@/lib/env";

const PUBLIC_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
} as const;

export function publicHeaders(additional?: HeadersInit): Headers {
  const headers = new Headers(PUBLIC_HEADERS);
  if (additional) new Headers(additional).forEach((value, key) => headers.set(key, value));
  return headers;
}

export function publicJson(
  value: unknown,
  init?: Readonly<{ status?: number; headers?: HeadersInit }>,
): Response {
  return Response.json(value, {
    status: init?.status ?? 200,
    headers: publicHeaders(init?.headers),
  });
}

export function genericAccessDenied(): Response {
  return publicJson(
    { error: { code: "CLIENT_ACCESS_INVALID", message: "Secure access is unavailable." } },
    { status: 401 },
  );
}

export function verifyPublicMutationRequest(request: Request): Response | null {
  const environment = getServerEnvironment();
  const origin = request.headers.get("origin");
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    origin !== environment.APP_PUBLIC_ORIGIN ||
    contentType !== "application/json" ||
    (fetchSite && fetchSite !== "same-origin")
  ) {
    return genericAccessDenied();
  }
  return null;
}

export async function readLimitedJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("REQUEST_TOO_LARGE");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

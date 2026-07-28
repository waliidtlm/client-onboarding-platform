export class RequestBodyTooLargeError extends Error {}

export async function readRawRequestBody(
  request: Request,
  maximumBytes = 65_536,
): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maximumBytes) {
    throw new RequestBodyTooLargeError("Request body exceeds the permitted size");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError("Request body exceeds the permitted size");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function parseJsonBody(rawBody: Uint8Array): unknown {
  if (rawBody.byteLength === 0) throw new SyntaxError("JSON body is required");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
}

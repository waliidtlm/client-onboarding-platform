export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_MULTI_FILE_COUNT = 5;
export const MAX_COMBINED_SUBMISSION_BYTES = 25 * 1024 * 1024;
export const UPLOAD_URL_SECONDS = 5 * 60;
export const UPLOAD_INTENT_SECONDS = 15 * 60;
export const DOWNLOAD_URL_SECONDS = 60;

export const ALLOWED_FILE_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

export type AllowedFileExtension = keyof typeof ALLOWED_FILE_TYPES;

export function isAllowedDetectedFile(
  extension: string | undefined,
  mimeType: string | undefined,
): extension is AllowedFileExtension {
  if (!extension || !mimeType) return false;
  return ALLOWED_FILE_TYPES[extension as AllowedFileExtension] === mimeType;
}

export function normalizeDisplayFilename(value: string): string | null {
  const normalized = value.normalize("NFKC").replaceAll("\0", "").trim();
  if (
    normalized.length < 1 ||
    normalized.length > 255 ||
    normalized.includes("\r") ||
    normalized.includes("\n") ||
    /[\\/]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function safeContentDisposition(filename: string): string {
  const normalized = normalizeDisplayFilename(filename) ?? "download";
  const ascii = normalized
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\;]/g, "_")
    .trim();
  const fallback = ascii || "download";
  const encoded = encodeURIComponent(normalized).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

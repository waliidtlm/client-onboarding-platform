import type { RequirementInputType } from "@/generated/prisma/client";
import {
  MAX_COMBINED_SUBMISSION_BYTES,
  MAX_FILE_BYTES,
  MAX_MULTI_FILE_COUNT,
} from "@/domain/requirements/file-policy";

export const MAX_TEXT_CHARACTERS = 10_000;
export const MAX_URL_CHARACTERS = 2_048;

export type SubmissionFile = Readonly<{ id: string; sizeBytes: bigint }>;

export type SubmissionValidationResult =
  | Readonly<{
      ok: true;
      textValue: string | null;
      urlValue: string | null;
      orderedFileIds: readonly string[];
    }>
  | Readonly<{ ok: false; code: string }>;

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function validateHttpsUrl(value: string): string | null {
  if (value.length > MAX_URL_CHARACTERS) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname ||
      url.hostname === "localhost" ||
      url.hostname.endsWith(".localhost")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function validateRequirementSubmission(
  inputType: RequirementInputType,
  input: Readonly<{
    textValue?: string | null;
    urlValue?: string | null;
    files?: readonly SubmissionFile[];
  }>,
): SubmissionValidationResult {
  const files = input.files ?? [];
  const hasText = input.textValue !== undefined && input.textValue !== null;
  const hasUrl = input.urlValue !== undefined && input.urlValue !== null;
  if (files.some((file) => file.sizeBytes <= 0 || file.sizeBytes > BigInt(MAX_FILE_BYTES))) {
    return { ok: false, code: "FILE_SIZE_INVALID" };
  }

  if (inputType === "TEXT") {
    if (hasUrl || files.length > 0 || !hasText) return { ok: false, code: "TEXT_ONLY_REQUIRED" };
    const textValue = normalizeText(input.textValue!);
    if (!textValue.trim() || textValue.length > MAX_TEXT_CHARACTERS) {
      return { ok: false, code: "TEXT_INVALID" };
    }
    return { ok: true, textValue, urlValue: null, orderedFileIds: [] };
  }

  if (inputType === "URL") {
    if (hasText || files.length > 0 || !hasUrl) return { ok: false, code: "URL_ONLY_REQUIRED" };
    const urlValue = validateHttpsUrl(input.urlValue!);
    return urlValue
      ? { ok: true, textValue: null, urlValue, orderedFileIds: [] }
      : { ok: false, code: "URL_INVALID" };
  }

  if (hasText || hasUrl) return { ok: false, code: "FILES_ONLY_REQUIRED" };
  const expectedCount = inputType === "FILE" ? 1 : files.length;
  if (
    files.length !== expectedCount ||
    files.length < 1 ||
    files.length > (inputType === "FILE" ? 1 : MAX_MULTI_FILE_COUNT) ||
    new Set(files.map((file) => file.id)).size !== files.length
  ) {
    return { ok: false, code: "FILE_COUNT_INVALID" };
  }
  const combined = files.reduce((total, file) => total + file.sizeBytes, 0n);
  if (combined > BigInt(MAX_COMBINED_SUBMISSION_BYTES)) {
    return { ok: false, code: "COMBINED_FILE_SIZE_INVALID" };
  }
  return {
    ok: true,
    textValue: null,
    urlValue: null,
    orderedFileIds: files.map((file) => file.id),
  };
}

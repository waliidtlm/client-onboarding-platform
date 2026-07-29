import { describe, expect, it } from "vitest";

import { calculateRequirementCompleteness } from "@/domain/requirements/completeness";
import {
  MAX_COMBINED_SUBMISSION_BYTES,
  normalizeDisplayFilename,
  safeContentDisposition,
} from "@/domain/requirements/file-policy";
import { validateRequirementSubmission } from "@/domain/requirements/submission-validation";

describe("Phase 5 requirement rules", () => {
  it("requires at least one mandatory requirement and all mandatory approvals", () => {
    expect(calculateRequirementCompleteness([]).configurationError).toBe(
      "NO_MANDATORY_REQUIREMENTS",
    );
    expect(
      calculateRequirementCompleteness([
        { id: "required", name: "Required", isRequired: true, status: "APPROVED" },
        { id: "optional", name: "Optional", isRequired: false, status: "PENDING" },
      ]).complete,
    ).toBe(true);
    expect(
      calculateRequirementCompleteness([
        { id: "required", name: "Required", isRequired: true, status: "REJECTED" },
      ]).complete,
    ).toBe(false);
  });

  it("enforces input-type shape and aggregate file limits", () => {
    expect(validateRequirementSubmission("TEXT", { textValue: " answer " }).ok).toBe(true);
    expect(validateRequirementSubmission("URL", { urlValue: "javascript:alert(1)" }).ok).toBe(
      false,
    );
    expect(
      validateRequirementSubmission("FILE", {
        files: [
          { id: "one", sizeBytes: 1n },
          { id: "two", sizeBytes: 1n },
        ],
      }).ok,
    ).toBe(false);
    expect(
      validateRequirementSubmission("MULTI_FILE", {
        files: [
          { id: "one", sizeBytes: BigInt(MAX_COMBINED_SUBMISSION_BYTES) },
          { id: "two", sizeBytes: 1n },
        ],
      }).ok,
    ).toBe(false);
  });

  it("normalizes display names and produces attachment-only disposition", () => {
    expect(normalizeDisplayFilename("../secret.pdf")).toBeNull();
    expect(normalizeDisplayFilename("invoice\r\n.pdf")).toBeNull();
    expect(safeContentDisposition('résumé "final".pdf')).toMatch(/^attachment;/);
  });
});

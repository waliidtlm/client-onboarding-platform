import { describe, expect, it } from "vitest";
import {
  calculateProvisioningReadiness,
  mayEnterInternalReview,
} from "@/domain/provisioning/readiness";

describe("provisioning readiness", () => {
  it("requires at least one required task", () => {
    expect(calculateProvisioningReadiness([])).toMatchObject({
      ready: false,
      requiredTaskCount: 0,
      blockers: [{ reason: "NO_REQUIRED_TASKS_CONFIGURED" }],
    });
  });

  it("accepts completed and manually accepted required tasks", () => {
    expect(
      calculateProvisioningReadiness([
        { id: "a", isRequired: true, status: "COMPLETED" },
        { id: "b", isRequired: true, status: "MANUALLY_ACCEPTED" },
        { id: "c", isRequired: false, status: "MANUAL_REVIEW_REQUIRED" },
      ]).ready,
    ).toBe(true);
  });

  it("keeps an optional runnable task out of internal review", () => {
    expect(
      mayEnterInternalReview([
        { id: "a", isRequired: true, status: "COMPLETED" },
        { id: "b", isRequired: false, status: "PENDING" },
      ]),
    ).toBe(false);
    expect(
      mayEnterInternalReview([
        { id: "a", isRequired: true, status: "COMPLETED" },
        { id: "b", isRequired: false, status: "MANUAL_REVIEW_REQUIRED" },
      ]),
    ).toBe(true);
  });
});

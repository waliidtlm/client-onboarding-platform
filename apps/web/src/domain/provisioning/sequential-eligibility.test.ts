import { describe, expect, it } from "vitest";
import { findNextEligibleProvisioningTask } from "@/domain/provisioning/sequential-eligibility";

describe("sequential provisioning eligibility", () => {
  it("does not skip an earlier optional pending task", () => {
    expect(
      findNextEligibleProvisioningTask([
        { id: "1", sequence: 1, isRequired: true, status: "COMPLETED" },
        { id: "2", sequence: 2, isRequired: false, status: "PENDING" },
        { id: "3", sequence: 3, isRequired: true, status: "PENDING" },
      ])?.id,
    ).toBe("2");
  });

  it("allows progress after an optional task reaches manual review", () => {
    expect(
      findNextEligibleProvisioningTask([
        { id: "1", sequence: 1, isRequired: true, status: "COMPLETED" },
        { id: "2", sequence: 2, isRequired: false, status: "MANUAL_REVIEW_REQUIRED" },
        { id: "3", sequence: 3, isRequired: true, status: "PENDING" },
      ])?.id,
    ).toBe("3");
  });

  it("blocks after required manual review and while any task runs", () => {
    expect(
      findNextEligibleProvisioningTask([
        { id: "1", sequence: 1, isRequired: true, status: "MANUAL_REVIEW_REQUIRED" },
        { id: "2", sequence: 2, isRequired: true, status: "PENDING" },
      ]),
    ).toBeNull();
    expect(
      findNextEligibleProvisioningTask([
        { id: "1", sequence: 1, isRequired: true, status: "IN_PROGRESS" },
        { id: "2", sequence: 2, isRequired: true, status: "PENDING" },
      ]),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  provisioningTaskEventDeduplicationKey,
  provisioningTaskIdempotencyKey,
  welcomeEmailDeduplicationKey,
} from "@/domain/provisioning/idempotency";

describe("Phase 4 idempotency keys", () => {
  it("keeps task event identity stable across retries", () => {
    expect(provisioningTaskEventDeduplicationKey("task-1")).toBe(
      "PROVISIONING_TASK_REQUESTED:task-1:v1",
    );
    expect(provisioningTaskIdempotencyKey("task-1")).toBe("PROVISION:task-1");
    expect(welcomeEmailDeduplicationKey("onb-1")).toBe("WELCOME_EMAIL:onb-1:v1");
  });
});

import { randomUUID } from "node:crypto";
import type { TransactionClient } from "@/application/commercial/service-support";

export type SandboxProviderResult =
  | Readonly<{
      kind: "COMPLETED";
      externalReference: string;
      idempotent: boolean;
      providerLabel: "Local sandbox resource";
    }>
  | Readonly<{
      kind: "FAILED";
      errorCode: "TEMPORARY_PROVIDER_FAILURE" | "PERMANENT_PROVIDER_FAILURE";
      errorMessage: string;
      retryable: boolean;
      providerLabel: "Local sandbox resource";
    }>;

export async function executeSandboxProvisioning(
  tx: TransactionClient,
  input: Readonly<{
    taskId: string;
    idempotencyKey: string;
    automationKey: string;
    taskName: string;
    attemptNumber: number;
  }>,
): Promise<SandboxProviderResult> {
  const existing = await tx.sandboxProvisionedResource.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return {
      kind: "COMPLETED",
      externalReference: existing.externalReference,
      idempotent: true,
      providerLabel: "Local sandbox resource",
    };
  }

  if (input.automationKey === "MANUAL_REVIEW_DEMO") {
    return {
      kind: "FAILED",
      errorCode: "PERMANENT_PROVIDER_FAILURE",
      errorMessage:
        "The local sandbox provider intentionally requires manual review for this isolated demo task.",
      retryable: false,
      providerLabel: "Local sandbox resource",
    };
  }

  if (input.automationKey === "CREATE_CAMPAIGN_PROJECT" && input.attemptNumber === 1) {
    return {
      kind: "FAILED",
      errorCode: "TEMPORARY_PROVIDER_FAILURE",
      errorMessage:
        "The local sandbox provider intentionally failed the first campaign-project attempt.",
      retryable: true,
      providerLabel: "Local sandbox resource",
    };
  }

  const resourceId = randomUUID();
  const externalReference = `sandbox://provisioning/${resourceId}`;
  const created = await tx.sandboxProvisionedResource.create({
    data: {
      id: resourceId,
      provisioningTaskId: input.taskId,
      idempotencyKey: input.idempotencyKey,
      resourceType: input.automationKey,
      displayName: input.taskName,
      externalReference,
    },
  });
  return {
    kind: "COMPLETED",
    externalReference: created.externalReference,
    idempotent: false,
    providerLabel: "Local sandbox resource",
  };
}

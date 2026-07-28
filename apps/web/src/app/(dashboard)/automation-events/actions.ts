"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { retryAutomationEvent } from "@/application/automation/manual-retry-service";
import { Permission, requirePermission } from "@/lib/auth/authorization";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function retryAutomationEventAction(formData: FormData): Promise<void> {
  const staff = await requirePermission(Permission.AUTOMATION_RETRY, "/automation-events");
  const result = await retryAutomationEvent({
    actorId: staff.id,
    eventId: text(formData, "eventId"),
    reason: text(formData, "reason"),
    correlationId: randomUUID(),
  });
  revalidatePath("/automation-events");
  if (!result.ok) {
    redirect(`/automation-events?error=${encodeURIComponent(result.error.message)}`);
  }
  redirect("/automation-events?success=Automation%20retry%20requested");
}

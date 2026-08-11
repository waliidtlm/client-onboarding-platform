import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const workflowsDirectory = path.resolve("automation/n8n/workflows");
const files = (await readdir(workflowsDirectory)).filter((file) => file.endsWith(".json")).sort();

if (files.length !== 6) {
  throw new Error(`Expected the Phase 3–6 consumers and shared handler; found ${files.length}`);
}

const ids = new Set();
for (const file of files) {
  const source = await readFile(path.join(workflowsDirectory, file), "utf8");
  const workflow = JSON.parse(source);
  if (workflow.active !== false) throw new Error(`${file} must be exported inactive`);
  if (!workflow.id || workflow.id.length > 36 || ids.has(workflow.id)) {
    throw new Error(`${file} has a missing, oversized, or duplicate id`);
  }
  ids.add(workflow.id);
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 2) {
    throw new Error(`${file} has no executable workflow graph`);
  }
  for (const node of workflow.nodes) {
    const code = node.parameters?.jsCode;
    if (typeof code === "string") {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      new AsyncFunction(code);
    }
  }
  if (/EXAMPLE_ONLY|integration-automation|local-phase3/i.test(source)) {
    throw new Error(`${file} contains a credential-like literal`);
  }
}

const consumer = JSON.parse(
  await readFile(
    path.join(workflowsDirectory, "phase3-onboarding-activation-consumer.json"),
    "utf8",
  ),
);
if (consumer.settings?.errorWorkflow !== "phase3-automation-error-handler") {
  throw new Error("The consumer must reference the shared Phase 3 error workflow");
}

const phase4 = JSON.parse(
  await readFile(
    path.join(workflowsDirectory, "phase4-internal-onboarding-and-provisioning.json"),
    "utf8",
  ),
);
const phase5 = JSON.parse(
  await readFile(path.join(workflowsDirectory, "phase5-client-access-email.json"), "utf8"),
);
const phase6 = JSON.parse(
  await readFile(path.join(workflowsDirectory, "phase6-kickoff-delivery-handoff.json"), "utf8"),
);
const phase7 = JSON.parse(
  await readFile(path.join(workflowsDirectory, "phase7-reminders-and-escalations.json"), "utf8"),
);
if (phase4.settings?.errorWorkflow !== "phase3-automation-error-handler") {
  throw new Error("The Phase 4 consumer must reference the shared error workflow");
}
if (
  phase4.active !== false ||
  phase5.active !== false ||
  phase6.active !== false ||
  phase7.active !== false ||
  consumer.active !== false
) {
  throw new Error("All polling consumer exports must remain inactive");
}
if (
  phase4.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger").length !== 1 ||
  consumer.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger").length !== 1 ||
  phase5.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger").length !== 1 ||
  phase6.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger").length !== 1 ||
  phase7.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger").length !== 1
) {
  throw new Error("Each retained consumer export must have exactly one polling trigger");
}
const phase6Source = JSON.stringify(phase6);
for (const eventType of [
  "CLIENT_REQUIREMENTS_COMPLETED",
  "KICKOFF_INVITATION_REQUESTED",
  "DELIVERY_HANDOFF_NOTIFICATION_REQUESTED",
  "PHASE6_CANCELLATION_NOTIFICATION_REQUESTED",
]) {
  if (!phase6Source.includes(eventType)) {
    throw new Error(`The Phase 6 workflow is missing capability ${eventType}`);
  }
}
if (
  !phase6Source.includes("AUTOMATION_PHASE6_SERVICE_TOKEN") ||
  /recipient|textContent|htmlContent|meetingUrl|outcomeNotes|sourceSnapshot/.test(phase6Source)
) {
  throw new Error("The Phase 6 workflow must dispatch identifiers without business content");
}
if (
  phase6.settings?.saveDataErrorExecution !== "none" ||
  phase6.settings?.saveDataSuccessExecution !== "none" ||
  phase6.settings?.saveManualExecutions !== false
) {
  throw new Error("The Phase 6 workflow must disable execution-data persistence");
}
const phase5Source = JSON.stringify(phase5);
if (
  !phase5Source.includes("AUTOMATION_PHASE5_SERVICE_TOKEN") ||
  !phase5Source.includes("CLIENT_ACCESS_EMAIL_REQUESTED") ||
  /#token=|tokenHash|tokenNonce|textContent|recipient/.test(phase5Source)
) {
  throw new Error("The Phase 5 workflow must use its dedicated capability without client secrets");
}
if (
  phase5.settings?.saveDataErrorExecution !== "none" ||
  phase5.settings?.saveDataSuccessExecution !== "none" ||
  phase5.settings?.saveManualExecutions !== false
) {
  throw new Error("The Phase 5 workflow must disable execution-data persistence");
}
if (
  phase4.settings?.saveDataErrorExecution !== "none" ||
  phase4.settings?.saveDataSuccessExecution !== "none" ||
  phase4.settings?.saveManualExecutions !== false
) {
  throw new Error("The Phase 4 workflow must disable execution-data persistence");
}
const phase7Source = JSON.stringify(phase7);
if (
  !phase7Source.includes("AUTOMATION_PHASE7_SERVICE_TOKEN") ||
  !phase7Source.includes("REMINDER_NOTIFICATION_REQUESTED") ||
  !phase7Source.includes("/api/internal/automation/reminders/evaluate") ||
  !phase7Source.includes("/api/internal/automation/reminders/deliver") ||
  /dueAt|thresholdHours|OVERDUE_1/.test(phase7Source)
) {
  throw new Error("The Phase 7 workflow must orchestrate IDs without reminder business rules");
}
const phase7Schedule = phase7.nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
if (phase7Schedule?.parameters?.rule?.interval?.[0]?.minutesInterval !== 15) {
  throw new Error("The Phase 7 workflow must poll every 15 minutes");
}
if (
  phase7.settings?.saveDataErrorExecution !== "none" ||
  phase7.settings?.saveDataSuccessExecution !== "none" ||
  phase7.settings?.saveManualExecutions !== false
) {
  throw new Error("The Phase 7 workflow must disable execution-data persistence");
}
const emailNode = phase4.nodes.find((node) => node.type === "n8n-nodes-base.emailSend");
if (!emailNode || emailNode.credentials) {
  throw new Error("The Phase 4 email node must not export an SMTP credential");
}
const prohibitedBusinessCode =
  /calculateProvisioningReadiness|PROJECT_MANAGER|MANUALLY_ACCEPTED|optionalFailuresBlock|nextEligible/;
for (const node of phase4.nodes) {
  if (
    typeof node.parameters?.jsCode === "string" &&
    prohibitedBusinessCode.test(node.parameters.jsCode)
  ) {
    throw new Error(`Phase 4 Code node ${node.name} contains application business rules`);
  }
}

console.log(`Validated ${files.length} inactive exports including isolated Phase 5-7 consumers.`);

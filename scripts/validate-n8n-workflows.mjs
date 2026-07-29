import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const workflowsDirectory = path.resolve("automation/n8n/workflows");
const files = (await readdir(workflowsDirectory)).filter((file) => file.endsWith(".json")).sort();

if (files.length !== 4) {
  throw new Error(
    `Expected the retained Phase 3 consumer, Phase 4 consumer, Phase 5 consumer, and shared handler; found ${files.length}`,
  );
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
if (phase4.settings?.errorWorkflow !== "phase3-automation-error-handler") {
  throw new Error("The Phase 4 consumer must reference the shared error workflow");
}
if (phase4.active !== false || phase5.active !== false || consumer.active !== false) {
  throw new Error("All polling consumer exports must remain inactive");
}
if (
  phase4.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger").length !== 1 ||
  consumer.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger").length !== 1 ||
  phase5.nodes.filter((node) => node.type === "n8n-nodes-base.scheduleTrigger").length !== 1
) {
  throw new Error("Each retained consumer export must have exactly one polling trigger");
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

console.log(
  `Validated ${files.length} inactive exports including the isolated Phase 5 email consumer.`,
);

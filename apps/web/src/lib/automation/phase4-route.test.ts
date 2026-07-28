import { describe, expect, it } from "vitest";

import { POST as initialize } from "@/app/api/internal/automation/provisioning/initialize/route";
import { POST as completeTask } from "@/app/api/internal/automation/provisioning/tasks/[taskId]/complete/route";
import { POST as executeTask } from "@/app/api/internal/automation/provisioning/tasks/[taskId]/execute/route";
import { POST as failTask } from "@/app/api/internal/automation/provisioning/tasks/[taskId]/failure/route";
import { POST as startTask } from "@/app/api/internal/automation/provisioning/tasks/[taskId]/start/route";
import { POST as beginWelcome } from "@/app/api/internal/automation/welcome-email/begin/route";
import { POST as recordWelcome } from "@/app/api/internal/automation/welcome-email/result/route";
import { signAutomationRequest } from "@/lib/automation/service-auth";

const taskId = "11111111-1111-4111-8111-111111111111";
const serviceToken = "unit-test-automation-service-token-000000";
const hmacSecret = "unit-test-automation-hmac-secret-000000";

const routes = [
  ["/api/internal/automation/provisioning/initialize", (request: Request) => initialize(request)],
  [
    `/api/internal/automation/provisioning/tasks/${taskId}/start`,
    (request: Request) => startTask(request, { params: Promise.resolve({ taskId }) }),
  ],
  [
    `/api/internal/automation/provisioning/tasks/${taskId}/execute`,
    (request: Request) => executeTask(request, { params: Promise.resolve({ taskId }) }),
  ],
  [
    `/api/internal/automation/provisioning/tasks/${taskId}/complete`,
    (request: Request) => completeTask(request, { params: Promise.resolve({ taskId }) }),
  ],
  [
    `/api/internal/automation/provisioning/tasks/${taskId}/failure`,
    (request: Request) => failTask(request, { params: Promise.resolve({ taskId }) }),
  ],
  ["/api/internal/automation/welcome-email/begin", (request: Request) => beginWelcome(request)],
  ["/api/internal/automation/welcome-email/result", (request: Request) => recordWelcome(request)],
] as const;

function signedRequest(path: string, body: string, signedBody = body): Request {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = signAutomationRequest(
    {
      method: "POST",
      requestTarget: path,
      timestamp,
      rawBody: new TextEncoder().encode(signedBody),
    },
    hmacSecret,
  );
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    body,
    headers: {
      authorization: `Bearer ${serviceToken}`,
      "content-type": "application/json",
      "x-automation-signature": signature,
      "x-automation-timestamp": timestamp,
    },
  });
}

describe("Phase 4 machine Route Handler boundary", () => {
  it.each(routes)("rejects unsigned requests before service work: %s", async (path, post) => {
    const response = await post(
      new Request(`http://127.0.0.1:3000${path}`, { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(401);
  });

  it.each(routes)("rejects altered signed bodies before service work: %s", async (path, post) => {
    const response = await post(signedRequest(path, "{}", '{"different":true}'));
    expect(response.status).toBe(401);
  });

  it.each(routes)("validates authenticated input before service work: %s", async (path, post) => {
    const response = await post(signedRequest(path, "{}"));
    expect(response.status).toBe(400);
  });
});

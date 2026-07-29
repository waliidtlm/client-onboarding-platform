import "dotenv/config";

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import {
  ActivationRequirementStatus,
  CommercialGateStatus,
  DealStatus,
  OnboardingStatus,
  SalesHandoffStatus,
} from "../src/generated/prisma/client";
import { manageClientAccess } from "../src/application/client-access/access-service";
import {
  approveClientRequirement,
  beginRequirementReview,
} from "../src/application/requirements/review-service";
import { prisma } from "../src/lib/database";

const publicOrigin = process.env.APP_PUBLIC_ORIGIN ?? "http://127.0.0.1:3001";
const mailpitApi = "http://127.0.0.1:8025/api/v1";
const clientEmail = `phase5-smoke-${Date.now()}@northstar.test`;

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function waitFor<T>(
  work: () => Promise<T | null>,
  label: string,
  timeoutMs = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await work();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function mailpitToken(): Promise<string | null> {
  const list = (await fetch(`${mailpitApi}/messages`).then((response) => response.json())) as {
    messages?: Array<{
      ID: string;
      To?: Array<{ Address?: string }>;
      Subject?: string;
    }>;
  };
  const message = list.messages?.find(
    (candidate) =>
      candidate.To?.some((recipient) => recipient.Address === clientEmail) &&
      candidate.Subject?.includes("Secure onboarding access"),
  );
  if (!message) return null;
  const detail = (await fetch(`${mailpitApi}/message/${message.ID}`).then((response) =>
    response.json(),
  )) as { Text?: string };
  const match = detail.Text?.match(/#token=([A-Za-z0-9._-]+)/);
  return match?.[1] ?? null;
}

function sessionHeaders(cookie: string, csrf: string): HeadersInit {
  return {
    Cookie: cookie,
    Origin: publicOrigin,
    "Sec-Fetch-Site": "same-origin",
    "Content-Type": "application/json",
    "X-CSRF-Token": csrf,
  };
}

async function publicJson(
  path: string,
  input: unknown,
  cookie: string,
  csrf: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${publicOrigin}${path}`, {
    method: "POST",
    headers: sessionHeaders(cookie, csrf),
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function uploadPdf(requirementId: string, cookie: string, csrf: string): Promise<string> {
  const bytes = Buffer.from(
    "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  );
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const intent = await publicJson(
    "/client-access/api/uploads/create",
    {
      requirementId,
      originalFilename: `phase5-${requirementId.slice(0, 8)}.pdf`,
      declaredMimeType: "application/pdf",
      declaredSizeBytes: bytes.length,
      declaredChecksum: checksum,
      idempotencyKey: randomUUID(),
    },
    cookie,
    csrf,
  );
  const upload = await fetch(String(intent.uploadUrl), {
    method: "PUT",
    headers: intent.requiredHeaders as Record<string, string>,
    body: bytes,
  });
  if (!upload.ok) {
    const signedUrl = new URL(String(intent.uploadUrl));
    throw new Error(
      `MinIO upload failed with ${upload.status}; signedHeaders=${signedUrl.searchParams.get("X-Amz-SignedHeaders")}; requiredHeaders=${Object.keys(intent.requiredHeaders as object).join(",")}; queryKeys=${[...signedUrl.searchParams.keys()].filter((key) => key !== "X-Amz-Signature").join(",")}: ${await upload.text()}`,
    );
  }
  const finalized = await publicJson(
    "/client-access/api/uploads/finalize",
    { uploadIntentId: intent.uploadIntentId },
    cookie,
    csrf,
  );
  return String(finalized.fileAssetId);
}

async function main() {
  const [admin, projectManager, sales, servicePackage] = await Promise.all([
    prisma.user.findUnique({ where: { email: "admin@northstar.test" } }),
    prisma.user.findUnique({ where: { email: "pm@northstar.test" } }),
    prisma.user.findUnique({ where: { email: "sales@northstar.test" } }),
    prisma.servicePackage.findUnique({
      where: { name: "Paid Growth Launch" },
      include: { requirementTemplates: true },
    }),
  ]);
  invariant(
    admin && projectManager && sales && servicePackage,
    "Seeded smoke prerequisites missing",
  );
  invariant(
    servicePackage.requirementTemplates.some((template) => template.isRequired),
    "Mandatory templates missing",
  );

  const client = await prisma.client.create({
    data: {
      companyName: `Phase 5 Smoke ${Date.now()}`,
      contactName: "Phase Five Client",
      contactEmail: clientEmail,
    },
  });
  const onboarding = await prisma.onboarding.create({
    data: {
      clientId: client.id,
      servicePackageId: servicePackage.id,
      externalDealId: `PHASE5-SMOKE-${Date.now()}`,
      dealStatus: DealStatus.CLOSED_WON,
      salesHandoffStatus: SalesHandoffStatus.COMPLETE,
      commercialGateStatus: CommercialGateStatus.APPROVED,
      commercialGateBlockingReasons: [],
      status: OnboardingStatus.CLIENT_AWAITING_ACTION,
      projectManagerId: projectManager.id,
      submittedById: sales.id,
      validatedById: admin.id,
      invoiceTotal: "10000.0000",
      currency: "USD",
      servicePackageNameSnapshot: servicePackage.name,
      activationTypeSnapshot: servicePackage.activationType,
      activationValueSnapshot: servicePackage.activationValue,
      activationRequiredAmount: "3000.0000",
      activationRequirementStatus: ActivationRequirementStatus.SATISFIED,
      activatedAt: new Date(),
      welcomeEmailSentAt: new Date(),
    },
  });

  const issued = await manageClientAccess({
    actorId: projectManager.id,
    onboardingId: onboarding.id,
    expectedVersion: onboarding.version,
    issuanceKey: `PHASE5-SMOKE:${randomUUID()}`,
    operation: "ISSUE",
    correlationId: randomUUID(),
  });
  invariant(issued.ok, `Access issuance failed: ${issued.ok ? "" : issued.error.code}`);

  const sentNotification = await waitFor(
    () =>
      prisma.notificationLog.findFirst({
        where: {
          onboardingId: onboarding.id,
          notificationType: "CLIENT_ACCESS_EMAIL",
          status: "SENT",
        },
      }),
    "n8n + Mailpit access delivery",
  );
  const rawToken = await waitFor(mailpitToken, "Mailpit message");
  invariant(
    sentNotification.textContent.includes("{{CLIENT_ACCESS_LINK}}") &&
      !sentNotification.textContent.includes(rawToken),
    "Frozen notification persisted a bearer",
  );

  const delivered = await prisma.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } });
  const generated = await prisma.clientRequirement.findMany({
    where: { onboardingId: onboarding.id },
    orderBy: { sequence: "asc" },
  });
  invariant(delivered.clientAccessDeliveredAt, "Access delivery timestamp missing");
  invariant(
    generated.every((requirement) => requirement.dueAt),
    "Due dates were not initialized",
  );

  const exchange = await fetch(`${publicOrigin}/client-access/api/exchange`, {
    method: "POST",
    headers: {
      Origin: publicOrigin,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: rawToken }),
  });
  invariant(exchange.ok, `Token exchange failed with ${exchange.status}`);
  const setCookies = exchange.headers.getSetCookie();
  const cookie = setCookies.map((value) => value.split(";")[0]).join("; ");
  const csrfCookie = setCookies.find((value) => value.startsWith("northstar_client_csrf="));
  invariant(csrfCookie, "CSRF cookie missing");
  const csrf = decodeURIComponent(csrfCookie.split(";")[0]!.split("=")[1]!);

  for (const requirement of generated.filter((item) => item.isRequired)) {
    const fileAssetIds =
      requirement.inputType === "FILE" || requirement.inputType === "MULTI_FILE"
        ? [await uploadPdf(requirement.id, cookie, csrf)]
        : [];
    await publicJson(
      `/client-access/api/requirements/${requirement.id}/submit`,
      {
        textValue:
          requirement.inputType === "TEXT"
            ? `Verified smoke response for ${requirement.name}`
            : null,
        urlValue: requirement.inputType === "URL" ? "https://example.com/phase5-smoke" : null,
        fileAssetIds,
        submissionIdempotencyKey: randomUUID(),
      },
      cookie,
      csrf,
    );
  }

  const submitted = await prisma.clientRequirement.findMany({
    where: { onboardingId: onboarding.id, isRequired: true },
    orderBy: { sequence: "asc" },
  });
  for (const requirement of submitted) {
    const begin = await beginRequirementReview({
      actorId: projectManager.id,
      onboardingId: onboarding.id,
      requirementId: requirement.id,
      expectedRequirementVersion: requirement.version,
      expectedSubmissionVersion: requirement.currentSubmissionVersion,
      correlationId: randomUUID(),
    });
    invariant(begin.ok, `Begin review failed for ${requirement.id}`);
    const reviewing = await prisma.clientRequirement.findUniqueOrThrow({
      where: { id: requirement.id },
    });
    const approved = await approveClientRequirement({
      actorId: projectManager.id,
      onboardingId: onboarding.id,
      requirementId: requirement.id,
      expectedRequirementVersion: reviewing.version,
      expectedSubmissionVersion: reviewing.currentSubmissionVersion,
      correlationId: randomUUID(),
    });
    invariant(approved.ok, `Approval failed for ${requirement.id}`);
  }

  const completed = await prisma.onboarding.findUniqueOrThrow({ where: { id: onboarding.id } });
  invariant(
    completed.status === OnboardingStatus.CLIENT_REQUIREMENTS_COMPLETE &&
      completed.requirementsCompletedAt,
    "Mandatory completion did not transition atomically",
  );
  const completionEvent = await prisma.automationEvent.findFirst({
    where: { aggregateId: onboarding.id, eventType: "CLIENT_REQUIREMENTS_COMPLETED" },
  });
  invariant(completionEvent?.status === "PENDING", "Completion event missing");

  const asset = await prisma.fileAsset.findFirstOrThrow({
    where: { onboardingId: onboarding.id, requirementSubmissionId: { not: null } },
  });
  const download = await publicJson(`/client-access/api/files/${asset.id}`, {}, cookie, csrf);
  const downloaded = await fetch(String(download.url));
  invariant(downloaded.ok, "Presigned final-object download failed");
  invariant(
    downloaded.headers.get("content-disposition")?.startsWith("attachment;"),
    "Safe attachment disposition missing",
  );
  const foreignAsset = await prisma.fileAsset.findFirst({
    where: {
      onboardingId: { not: onboarding.id },
      requirementSubmissionId: { not: null },
    },
  });
  if (foreignAsset) {
    const crossDownload = await fetch(
      `${publicOrigin}/client-access/api/files/${foreignAsset.id}`,
      {
        method: "POST",
        headers: sessionHeaders(cookie, csrf),
        body: "{}",
      },
    );
    invariant(!crossDownload.ok, "Cross-onboarding download was authorized");
  }
  const foreignRequirement = await prisma.clientRequirement.findFirst({
    where: { onboardingId: { not: onboarding.id }, inputType: "FILE" },
  });
  if (foreignRequirement) {
    const probe = Buffer.from("%PDF-1.4\n%%EOF\n");
    const crossUpload = await fetch(`${publicOrigin}/client-access/api/uploads/create`, {
      method: "POST",
      headers: sessionHeaders(cookie, csrf),
      body: JSON.stringify({
        requirementId: foreignRequirement.id,
        originalFilename: "ownership-probe.pdf",
        declaredMimeType: "application/pdf",
        declaredSizeBytes: probe.length,
        declaredChecksum: createHash("sha256").update(probe).digest("hex"),
        idempotencyKey: randomUUID(),
      }),
    });
    invariant(!crossUpload.ok, "Cross-onboarding upload intent was authorized");
  }

  const [audit, tokens, notifications, events, runs] = await Promise.all([
    prisma.auditEvent.findMany({ where: { onboardingId: onboarding.id } }),
    prisma.clientAccessToken.findMany({ where: { onboardingId: onboarding.id } }),
    prisma.notificationLog.findMany({ where: { onboardingId: onboarding.id } }),
    prisma.automationEvent.findMany({ where: { aggregateId: onboarding.id } }),
    prisma.automationRun.findMany({
      where: { automationEvent: { aggregateId: onboarding.id } },
    }),
  ]);
  invariant(
    !JSON.stringify({ audit, tokens, notifications, events, runs }).includes(rawToken),
    "Bearer appeared in application persistence",
  );
  const webLogs = spawnSync(
    "docker",
    ["compose", "--env-file", ".env", "logs", "--no-color", "web"],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  invariant(webLogs.status === 0, "Application logs could not be inspected");
  invariant(!webLogs.stdout.includes(rawToken), "Bearer appeared in application logs");
  const n8nScan = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "platform_admin",
      "-d",
      "n8n_internal",
      "-At",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: `SELECT count(*) FROM execution_data WHERE position($capability$${rawToken}$capability$ in data) > 0;\n`,
    },
  );
  invariant(n8nScan.status === 0, "n8n execution persistence could not be inspected");
  invariant(n8nScan.stdout.trim() === "0", "Bearer appeared in n8n execution persistence");
  process.stdout.write(
    `${JSON.stringify({
      onboardingId: onboarding.id,
      notificationStatus: sentNotification.status,
      requirements: generated.length,
      mandatoryApproved: submitted.length,
      completionEventStatus: completionEvent.status,
      finalizedAssetId: asset.id,
      rawBearerPersisted: false,
    })}\n`,
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}

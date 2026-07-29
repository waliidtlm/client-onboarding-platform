"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type PortalFile = {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: string;
};

type PortalSubmission = {
  submissionVersion: number;
  textValue: string | null;
  urlValue: string | null;
  submittedAt: string;
  reviewDecision: string | null;
  reviewReason: string | null;
  files: PortalFile[];
};

type Requirement = {
  id: string;
  name: string;
  description: string;
  inputType: "TEXT" | "URL" | "FILE" | "MULTI_FILE";
  isRequired: boolean;
  dueAt: string | null;
  status: string;
  version: number;
  latestSubmission: PortalSubmission | null;
  previousSubmissions: PortalSubmission[];
};

type Portal = {
  clientCompany: string;
  packageName: string;
  status: string;
  requirementsCompletedAt: string | null;
  requirements: Requirement[];
};

function csrfToken(): string {
  const prefix = "northstar_client_csrf=";
  const value = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}

async function jsonRequest(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
      ...(options?.method && options.method !== "GET" ? { "X-CSRF-Token": csrfToken() } : {}),
      ...options?.headers,
    },
  });
  const body = (await response.json()) as {
    error?: { message?: string };
    [key: string]: unknown;
  };
  if (!response.ok) throw new Error(body.error?.message ?? "The request could not be completed.");
  return body;
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function declaredMimeType(file: File): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return extension
    ? (byExtension[extension] ?? "application/octet-stream")
    : "application/octet-stream";
}

function RequirementForm({
  requirement,
  onChanged,
}: {
  requirement: Requirement;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const readOnly = !["PENDING", "REJECTED"].includes(requirement.status);

  async function uploadFile(file: File): Promise<string> {
    const checksum = await sha256(file);
    const intent = await jsonRequest("/client-access/api/uploads/create", {
      method: "POST",
      body: JSON.stringify({
        requirementId: requirement.id,
        originalFilename: file.name,
        declaredMimeType: declaredMimeType(file),
        declaredSizeBytes: file.size,
        declaredChecksum: checksum,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const requiredHeaders = intent.requiredHeaders as Record<string, string>;
    const upload = await fetch(String(intent.uploadUrl), {
      method: "PUT",
      headers: requiredHeaders,
      body: file,
    });
    if (!upload.ok) throw new Error("The file upload failed.");
    const finalized = await jsonRequest("/client-access/api/uploads/finalize", {
      method: "POST",
      body: JSON.stringify({ uploadIntentId: intent.uploadIntentId }),
    });
    return String(finalized.fileAssetId);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = new FormData(event.currentTarget);
      const files = data
        .getAll("files")
        .filter((value): value is File => value instanceof File && value.size > 0);
      const fileAssetIds: string[] = [];
      for (const file of files) fileAssetIds.push(await uploadFile(file));
      await jsonRequest(`/client-access/api/requirements/${requirement.id}/submit`, {
        method: "POST",
        body: JSON.stringify({
          textValue: requirement.inputType === "TEXT" ? String(data.get("value") ?? "") : null,
          urlValue: requirement.inputType === "URL" ? String(data.get("value") ?? "") : null,
          fileAssetIds,
          submissionIdempotencyKey: crypto.randomUUID(),
        }),
      });
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  }

  async function download(assetId: string) {
    try {
      const result = await jsonRequest(`/client-access/api/files/${assetId}`, {
        method: "POST",
        body: "{}",
      });
      window.location.assign(String(result.url));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Download failed.");
    }
  }

  return (
    <article className={`client-requirement status-${requirement.status.toLowerCase()}`}>
      <div className="client-requirement-heading">
        <div>
          <p className="task-sequence">
            {requirement.isRequired ? "Required" : "Optional"}
            {requirement.dueAt ? ` · Due ${new Date(requirement.dueAt).toLocaleDateString()}` : ""}
          </p>
          <h2>{requirement.name}</h2>
        </div>
        <strong>{requirement.status.replaceAll("_", " ")}</strong>
      </div>
      <p>{requirement.description}</p>
      {requirement.latestSubmission ? (
        <div className="client-submission">
          <p>Submitted {new Date(requirement.latestSubmission.submittedAt).toLocaleString()}</p>
          {requirement.latestSubmission.textValue ? (
            <p>{requirement.latestSubmission.textValue}</p>
          ) : null}
          {requirement.latestSubmission.urlValue ? (
            <p>
              <a
                href={requirement.latestSubmission.urlValue}
                rel="noopener noreferrer"
                target="_blank"
              >
                Submitted link
              </a>
            </p>
          ) : null}
          {requirement.latestSubmission.files.map((file) => (
            <button
              className="button-secondary"
              key={file.id}
              onClick={() => void download(file.id)}
              type="button"
            >
              Download {file.originalFilename}
            </button>
          ))}
          {requirement.status === "REJECTED" && requirement.latestSubmission.reviewReason ? (
            <p className="notice notice-error">
              Revision requested: {requirement.latestSubmission.reviewReason}
            </p>
          ) : null}
        </div>
      ) : null}
      {requirement.previousSubmissions.length > 0 ? (
        <details>
          <summary>Previous submissions ({requirement.previousSubmissions.length})</summary>
          {requirement.previousSubmissions.map((submission) => (
            <div className="client-submission" key={submission.submissionVersion}>
              <p>
                Version {submission.submissionVersion} · submitted{" "}
                {new Date(submission.submittedAt).toLocaleString()}
              </p>
              {submission.textValue ? <p>{submission.textValue}</p> : null}
              {submission.urlValue ? (
                <p>
                  <a href={submission.urlValue} rel="noopener noreferrer" target="_blank">
                    Submitted link
                  </a>
                </p>
              ) : null}
              {submission.files.map((file) => (
                <button
                  className="button-secondary"
                  key={file.id}
                  onClick={() => void download(file.id)}
                  type="button"
                >
                  Download {file.originalFilename}
                </button>
              ))}
              {submission.reviewReason ? <p>{submission.reviewReason}</p> : null}
            </div>
          ))}
        </details>
      ) : null}
      {!readOnly ? (
        <form className="inline-form" onSubmit={(event) => void submit(event)}>
          {requirement.inputType === "TEXT" ? (
            <label>
              Your response
              <textarea maxLength={10_000} name="value" required rows={5} />
            </label>
          ) : null}
          {requirement.inputType === "URL" ? (
            <label>
              Secure URL
              <input name="value" required type="url" />
            </label>
          ) : null}
          {requirement.inputType === "FILE" ? (
            <label>
              File
              <input accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx" name="files" required type="file" />
            </label>
          ) : null}
          {requirement.inputType === "MULTI_FILE" ? (
            <label>
              Files (up to 5; 25 MB combined)
              <input
                accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
                multiple
                name="files"
                required
                type="file"
              />
            </label>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          <button disabled={busy} type="submit">
            {busy ? "Submitting…" : requirement.status === "REJECTED" ? "Resubmit" : "Submit"}
          </button>
        </form>
      ) : null}
      {readOnly && error ? <p className="form-error">{error}</p> : null}
    </article>
  );
}

export function ClientPortal() {
  const [portal, setPortal] = useState<Portal | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied">("loading");
  const [message, setMessage] = useState("Opening secure access…");

  const load = useCallback(async () => {
    const context = (await jsonRequest("/client-access/api/context")) as unknown as Portal;
    setPortal(context);
    setState("ready");
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const token = fragment.get("token");
        if (token) {
          history.replaceState(null, "", `${location.pathname}${location.search}`);
          setMessage("Verifying your secure link…");
          await jsonRequest("/client-access/api/exchange", {
            method: "POST",
            body: JSON.stringify({ token }),
            headers: { "X-CSRF-Token": "" },
          });
        }
        await load();
      } catch (caught) {
        setMessage(
          caught instanceof Error
            ? caught.message
            : "This secure link is invalid, expired, or no longer active.",
        );
        setState("denied");
      }
    })();
  }, [load]);

  if (state !== "ready" || !portal) {
    return (
      <main className="client-access-shell">
        <section className="client-access-card">
          <p className="eyebrow">Secure client access</p>
          <h1>{state === "denied" ? "Access unavailable" : "Please wait"}</h1>
          <p className={state === "denied" ? "notice notice-error" : "lead"}>{message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="client-access-shell">
      <header className="client-access-header">
        <div>
          <p className="eyebrow">Secure client access</p>
          <h1>{portal.clientCompany}</h1>
          <p className="lead">{portal.packageName}</p>
        </div>
        <strong>{portal.status.replaceAll("_", " ")}</strong>
      </header>
      {portal.requirementsCompletedAt ? (
        <p className="notice notice-success">
          All required items have been approved. Your onboarding team will continue from here.
        </p>
      ) : null}
      <section className="client-requirements-list">
        {portal.requirements.map((requirement) => (
          <RequirementForm key={requirement.id} onChanged={load} requirement={requirement} />
        ))}
      </section>
    </main>
  );
}

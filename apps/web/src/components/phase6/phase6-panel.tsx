import { randomUUID } from "node:crypto";

import {
  acknowledgeHandoffAction,
  completeKickoffAction,
  markHandoffReadyAction,
  reassignHandoffAction,
  saveHandoffDraftAction,
  scheduleKickoffAction,
  waiveKickoffInvitationAction,
  resolvePhase6NotificationAction,
} from "@/app/(dashboard)/onboardings/[id]/phase6-actions";
import type { loadPhase6Workspace } from "@/application/phase6/query-service";
import type { Role } from "@/generated/prisma/client";

type Workspace = NonNullable<Awaited<ReturnType<typeof loadPhase6Workspace>>>;

export function Phase6Panel({
  workspace,
  role,
  deliveryUsers,
}: {
  workspace: Workspace;
  role: Role;
  deliveryUsers: readonly { id: string; name: string; email: string }[];
}) {
  const kickoff = workspace.kickoff;
  const handoff = workspace.deliveryHandoff;
  const canManage = role === "ADMIN" || role === "PROJECT_MANAGER";
  const canAcknowledge =
    handoff?.status === "NOTIFIED" &&
    (role === "ADMIN" || (role === "DELIVERY" && handoff.assignedDeliveryUser?.id !== undefined));

  return (
    <>
      <article className="detail-card">
        <h2>Kickoff</h2>
        {!kickoff ? (
          <p>Kickoff has not been initialized.</p>
        ) : (
          <>
            <dl>
              <div>
                <dt>Status</dt>
                <dd>{kickoff.status}</dd>
              </div>
              <div>
                <dt>Schedule revision</dt>
                <dd>{kickoff.scheduleRevision}</dd>
              </div>
              <div>
                <dt>Starts</dt>
                <dd>{kickoff.scheduledStartAt ?? "Not scheduled"}</dd>
              </div>
              <div>
                <dt>Timezone</dt>
                <dd>{kickoff.timezone ?? "Not set"}</dd>
              </div>
              <div>
                <dt>Invitation</dt>
                <dd>{kickoff.notifications[0]?.status ?? "Not queued"}</dd>
              </div>
            </dl>
            {kickoff.meetingUrl ? (
              <p>
                <a href={kickoff.meetingUrl} rel="noopener noreferrer" target="_blank">
                  Open meeting
                </a>
              </p>
            ) : null}
            {kickoff.meetingLocation ? <p>Location: {kickoff.meetingLocation}</p> : null}
            {kickoff.outcomeNotes ? <p className="notice">{kickoff.outcomeNotes}</p> : null}
          </>
        )}
        {canManage && kickoff && ["PENDING", "SCHEDULED", "CANCELLED"].includes(kickoff.status) ? (
          <form action={scheduleKickoffAction} className="inline-form">
            <input name="onboardingId" type="hidden" value={workspace.id} />
            <input name="expectedKickoffVersion" type="hidden" value={kickoff.version} />
            <input name="idempotencyKey" type="hidden" value={randomUUID()} />
            <label>
              Date
              <input name="localDate" required type="date" />
            </label>
            <label>
              Local time
              <input name="localTime" required type="time" />
            </label>
            <label>
              IANA timezone
              <input defaultValue="Africa/Casablanca" name="timezone" required />
            </label>
            <label>
              Repeated-time choice
              <select defaultValue="" name="ambiguityChoice">
                <option value="">Not applicable</option>
                <option value="EARLIER">Earlier occurrence</option>
                <option value="LATER">Later occurrence</option>
              </select>
            </label>
            <label>
              HTTPS meeting URL
              <input name="meetingUrl" type="url" />
            </label>
            <label>
              Meeting location
              <input name="meetingLocation" />
            </label>
            {kickoff.status !== "PENDING" ? (
              <label>
                Reschedule reason
                <textarea minLength={10} name="reason" required />
              </label>
            ) : null}
            <button type="submit">
              {kickoff.status === "PENDING" ? "Schedule kickoff" : "Reschedule kickoff"}
            </button>
          </form>
        ) : null}
        {role === "ADMIN" && kickoff?.status === "SCHEDULED" ? (
          <form action={waiveKickoffInvitationAction} className="inline-form">
            <input name="onboardingId" type="hidden" value={workspace.id} />
            <input name="expectedKickoffVersion" type="hidden" value={kickoff.version} />
            <label>
              Invitation waiver reason
              <textarea minLength={10} name="reason" required />
            </label>
            <button className="button-secondary" type="submit">
              Record Admin waiver
            </button>
          </form>
        ) : null}
        {canManage && kickoff?.status === "SCHEDULED" ? (
          <form action={completeKickoffAction} className="inline-form">
            <input name="onboardingId" type="hidden" value={workspace.id} />
            <input name="expectedKickoffVersion" type="hidden" value={kickoff.version} />
            <input name="idempotencyKey" type="hidden" value={randomUUID()} />
            <label>
              Outcome notes
              <textarea minLength={40} maxLength={5000} name="outcomeNotes" required />
            </label>
            {role === "ADMIN" ? (
              <label>
                Early-completion override reason
                <textarea minLength={10} name="timingOverrideReason" />
              </label>
            ) : null}
            <button type="submit">Complete kickoff</button>
          </form>
        ) : null}
      </article>

      {handoff ? (
        <article className="detail-card">
          <h2>Delivery handoff</h2>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{handoff.status}</dd>
            </div>
            <div>
              <dt>Assigned Delivery</dt>
              <dd>{handoff.assignedDeliveryUser?.name ?? "Unassigned"}</dd>
            </div>
            <div>
              <dt>Assignment revision</dt>
              <dd>{handoff.assignmentRevision}</dd>
            </div>
            <div>
              <dt>Source fingerprint</dt>
              <dd>{handoff.sourceFingerprint ?? "Not generated"}</dd>
            </div>
          </dl>
          {handoff.summary ? (
            <p>
              <strong>Summary:</strong> {handoff.summary}
            </p>
          ) : null}
          {handoff.riskNotes ? (
            <p>
              <strong>Risks:</strong> {handoff.riskNotes}
            </p>
          ) : null}
          {handoff.nextActions ? (
            <p>
              <strong>Next actions:</strong> {handoff.nextActions}
            </p>
          ) : null}

          {canManage && handoff.status === "DRAFT" ? (
            <form action={saveHandoffDraftAction} className="inline-form">
              <input name="onboardingId" type="hidden" value={workspace.id} />
              <input name="expectedHandoffVersion" type="hidden" value={handoff.version} />
              <label>
                Assigned Delivery
                <select
                  defaultValue={handoff.assignedDeliveryUser?.id ?? ""}
                  name="assignedDeliveryId"
                >
                  <option value="">Unassigned</option>
                  {deliveryUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Summary
                <textarea defaultValue={handoff.summary ?? ""} minLength={40} name="summary" />
              </label>
              <label>
                Risk notes
                <textarea defaultValue={handoff.riskNotes ?? ""} name="riskNotes" />
              </label>
              <label>
                Next actions
                <textarea defaultValue={handoff.nextActions ?? ""} name="nextActions" />
              </label>
              <button type="submit">Save handoff draft</button>
            </form>
          ) : null}
          {canManage &&
          handoff.status === "DRAFT" &&
          handoff.assignedDeliveryUser &&
          handoff.summary ? (
            <form action={markHandoffReadyAction} className="inline-form">
              <input name="onboardingId" type="hidden" value={workspace.id} />
              <input name="expectedHandoffVersion" type="hidden" value={handoff.version} />
              <input name="idempotencyKey" type="hidden" value={randomUUID()} />
              <button type="submit">Mark ready and notify Delivery</button>
            </form>
          ) : null}
          {canManage && ["READY", "NOTIFIED"].includes(handoff.status) ? (
            <form action={reassignHandoffAction} className="inline-form">
              <input name="onboardingId" type="hidden" value={workspace.id} />
              <input name="expectedHandoffVersion" type="hidden" value={handoff.version} />
              <input name="idempotencyKey" type="hidden" value={randomUUID()} />
              <label>
                New Delivery owner
                <select name="assignedDeliveryId" required>
                  {deliveryUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reassignment reason
                <textarea minLength={10} name="reason" required />
              </label>
              <button className="button-secondary" type="submit">
                Reassign and notify
              </button>
            </form>
          ) : null}
          {canAcknowledge ? (
            <form action={acknowledgeHandoffAction} className="inline-form">
              <input name="onboardingId" type="hidden" value={workspace.id} />
              <input name="expectedHandoffVersion" type="hidden" value={handoff.version} />
              <input name="expectedOnboardingVersion" type="hidden" value={workspace.version} />
              <input name="idempotencyKey" type="hidden" value={randomUUID()} />
              {role === "ADMIN" ? (
                <label>
                  Admin exception reason
                  <textarea minLength={10} name="adminExceptionReason" required />
                </label>
              ) : null}
              <button type="submit">Acknowledge handoff</button>
            </form>
          ) : null}
        </article>
      ) : null}

      {workspace.requirements.length > 0 ? (
        <article className="detail-card">
          <h2>Approved client requirements</h2>
          {workspace.requirements.map((requirement) => (
            <section key={requirement.id}>
              <h3>{requirement.name}</h3>
              {requirement.submission?.textValue ? <p>{requirement.submission.textValue}</p> : null}
              {requirement.submission?.urlValue ? (
                <p>
                  <a
                    href={requirement.submission.urlValue}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Approved link
                  </a>
                </p>
              ) : null}
              {requirement.submission?.files.map((file) => (
                <p key={file.id}>
                  <a href={`/api/staff/files/${file.id}`}>Download {file.originalFilename}</a> (
                  {file.mimeType}, {file.sizeBytes} bytes)
                </p>
              ))}
            </section>
          ))}
        </article>
      ) : null}

      {role === "ADMIN" &&
      workspace.phase6Notifications.some(
        (notification) => notification.status === "DELIVERY_UNCERTAIN",
      ) ? (
        <article className="detail-card">
          <h2>Phase 6 notification recovery</h2>
          {workspace.phase6Notifications
            .filter((notification) => notification.status === "DELIVERY_UNCERTAIN")
            .map((notification) => (
              <form
                action={resolvePhase6NotificationAction}
                className="inline-form"
                key={notification.id}
              >
                <input name="onboardingId" type="hidden" value={workspace.id} />
                <input name="notificationId" type="hidden" value={notification.id} />
                <input name="expectedOnboardingVersion" type="hidden" value={workspace.version} />
                <p>
                  {notification.notificationType} revision {notification.businessRevision}
                </p>
                <label>
                  Resolution
                  <select name="decision">
                    <option value="CONFIRM_SENT">Confirm sent</option>
                    <option value="RETRY">Authorize one resend</option>
                  </select>
                </label>
                <label>
                  Provider reference (optional)
                  <input name="providerReference" />
                </label>
                <label>
                  Resolution reason
                  <textarea minLength={10} name="reason" required />
                </label>
                <button type="submit">Resolve uncertainty</button>
              </form>
            ))}
        </article>
      ) : null}
    </>
  );
}

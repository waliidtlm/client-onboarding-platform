"use client";

import { useActionState } from "react";

import {
  openCommercialExceptionAction,
  resolveCommercialExceptionAction,
} from "@/app/(dashboard)/onboardings/actions";
import { initialCommercialActionState } from "@/application/commercial/action-state";

function ResolveExceptionForm({
  onboardingId,
  version,
  exceptionId,
}: Readonly<{
  onboardingId: string;
  version: number;
  exceptionId: string;
}>) {
  const [state, action, pending] = useActionState(
    resolveCommercialExceptionAction,
    initialCommercialActionState,
  );
  return (
    <form action={action} className="inline-form">
      <input name="onboardingId" type="hidden" value={onboardingId} />
      <input name="expectedVersion" type="hidden" value={version} />
      <input name="exceptionId" type="hidden" value={exceptionId} />
      <label>
        Resolution
        <select name="resolution">
          <option value="RESOLVED">Resolved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      <label>
        Resolution note
        <input name="resolutionNote" required />
      </label>
      <button disabled={pending}>Resolve exception</button>
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function CommercialExceptionControls(
  props: Readonly<{
    onboardingId: string;
    version: number;
    exceptions: readonly Readonly<{ id: string; status: string; reason: string }>[];
  }>,
) {
  const [state, action, pending] = useActionState(
    openCommercialExceptionAction,
    initialCommercialActionState,
  );
  return (
    <div className="commercial-controls">
      <form action={action} className="inline-form">
        <input name="onboardingId" type="hidden" value={props.onboardingId} />
        <input name="expectedVersion" type="hidden" value={props.version} />
        <label>
          Exception reason
          <input name="reason" required />
        </label>
        <button disabled={pending}>Open commercial exception</button>
        {state.message ? (
          <p className="form-error" role="alert">
            {state.message}
          </p>
        ) : null}
      </form>
      {props.exceptions.map((exception) => (
        <article className="payment-review-card" key={exception.id}>
          <p>
            <strong>{exception.status}</strong> · {exception.reason}
          </p>
          {exception.status === "OPEN" ? (
            <ResolveExceptionForm
              onboardingId={props.onboardingId}
              version={props.version}
              exceptionId={exception.id}
            />
          ) : null}
        </article>
      ))}
    </div>
  );
}

"use client";

import { useActionState } from "react";

import {
  approveManualActivationAction,
  cancelOnboardingAction,
  recalculateCommercialGateAction,
  revokeManualActivationAction,
  updateDealStatusAction,
} from "@/app/(dashboard)/onboardings/actions";
import { initialCommercialActionState } from "@/application/commercial/action-state";

function ActionMessage({ message }: { message: string }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;
}

export function CommercialGatePanel(
  props: Readonly<{
    onboardingId: string;
    version: number;
    onboardingStatus: string;
    dealStatus: string | null;
    gateStatus: string;
    blockers: readonly string[];
    activationType: string | null;
    manualApprovalActive: boolean;
    canUpdateDeal: boolean;
    canApproveManual: boolean;
    canRecalculate: boolean;
    canCancel: boolean;
  }>,
) {
  const [dealState, dealAction, dealPending] = useActionState(
    updateDealStatusAction,
    initialCommercialActionState,
  );
  const [approveState, approveAction, approvePending] = useActionState(
    approveManualActivationAction,
    initialCommercialActionState,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeManualActivationAction,
    initialCommercialActionState,
  );
  const [gateState, gateAction, gatePending] = useActionState(
    recalculateCommercialGateAction,
    initialCommercialActionState,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState(
    cancelOnboardingAction,
    initialCommercialActionState,
  );
  const hidden = (
    <>
      <input name="onboardingId" type="hidden" value={props.onboardingId} />
      <input name="expectedVersion" type="hidden" value={props.version} />
    </>
  );

  return (
    <div className="commercial-controls">
      <div className="gate-result">
        <strong>Commercial Gate: {props.gateStatus}</strong>
        {props.blockers.length ? (
          <ul>
            {props.blockers.map((blocker) => (
              <li key={blocker}>{blocker.replaceAll("_", " ")}</li>
            ))}
          </ul>
        ) : (
          <p>No commercial blockers remain.</p>
        )}
      </div>

      {props.canUpdateDeal && props.onboardingStatus === "COMMERCIAL_PENDING" ? (
        <form action={dealAction} className="inline-form">
          {hidden}
          <label>
            Deal status
            <select defaultValue={props.dealStatus ?? "OPEN"} name="dealStatus">
              <option value="OPEN">Open</option>
              <option value="CLOSED_WON">Closed won</option>
              <option value="CLOSED_LOST">Closed lost</option>
            </select>
          </label>
          <button disabled={dealPending}>Update deal</button>
          <ActionMessage message={dealState.message} />
        </form>
      ) : null}

      {props.canApproveManual && props.activationType === "MANUAL_APPROVAL" ? (
        props.manualApprovalActive ? (
          <form action={revokeAction} className="inline-form">
            {hidden}
            <label>
              Revocation reason
              <input name="reason" required />
            </label>
            <button disabled={revokePending}>Revoke manual approval</button>
            <ActionMessage message={revokeState.message} />
          </form>
        ) : (
          <form action={approveAction} className="inline-form">
            {hidden}
            <button disabled={approvePending}>Approve manual activation</button>
            <ActionMessage message={approveState.message} />
          </form>
        )
      ) : null}

      {props.canRecalculate ? (
        <form action={gateAction} className="inline-form">
          {hidden}
          <button className="button-secondary" disabled={gatePending}>
            Recalculate gate
          </button>
          <ActionMessage message={gateState.message} />
        </form>
      ) : null}

      {props.canCancel &&
      !["CANCELLED", "ARCHIVED", "COMPLETED"].includes(props.onboardingStatus) ? (
        <form action={cancelAction} className="inline-form danger-zone">
          {hidden}
          <label>
            Cancellation reason
            <input name="reason" required />
          </label>
          <button className="button-danger" disabled={cancelPending}>
            Cancel onboarding
          </button>
          <ActionMessage message={cancelState.message} />
        </form>
      ) : null}
    </div>
  );
}

"use client";

import { useActionState } from "react";

import { updateContractStatusAction } from "@/app/(dashboard)/onboardings/actions";
import { initialCommercialActionState } from "@/application/commercial/action-state";

export function ContractControls({
  onboardingId,
  version,
  currentStatus,
}: Readonly<{ onboardingId: string; version: number; currentStatus: string }>) {
  const [state, action, pending] = useActionState(
    updateContractStatusAction,
    initialCommercialActionState,
  );

  return (
    <form action={action} className="commercial-form compact-form">
      <input name="onboardingId" type="hidden" value={onboardingId} />
      <input name="expectedVersion" type="hidden" value={version} />
      <p>
        Current contract status: <strong>{currentStatus}</strong>
      </p>
      <div className="form-grid">
        <label>
          New contract status
          <select name="targetStatus">
            <option value="DRAFT">Draft</option>
            <option value="PENDING_SIGNATURE">Pending signature</option>
            <option value="REVISION_REQUESTED">Revision requested</option>
            <option value="SIGNED">Signed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </label>
        <label>
          Signature deadline
          <input name="signatureDeadline" type="date" />
        </label>
        <label>
          External contract reference
          <input name="externalReference" />
        </label>
        <label>
          Revision reason
          <input name="revisionReason" />
        </label>
      </div>
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <button disabled={pending}>Update contract</button>
    </form>
  );
}

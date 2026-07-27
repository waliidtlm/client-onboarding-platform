"use client";

import { useActionState } from "react";

import {
  issueActivationInvoiceAction,
  recordPaymentAction,
  reviewPaymentAction,
} from "@/app/(dashboard)/onboardings/actions";
import { initialCommercialActionState } from "@/application/commercial/action-state";

type Payment = Readonly<{
  id: string;
  originalAmount: string;
  verifiedAmount: string | null;
  verificationStatus: string;
  discrepancyReason: string | null;
  version: number;
}>;

function PaymentReviewForm({
  onboardingId,
  onboardingVersion,
  payment,
}: Readonly<{
  onboardingId: string;
  onboardingVersion: number;
  payment: Payment;
}>) {
  const [state, action, pending] = useActionState(
    reviewPaymentAction,
    initialCommercialActionState,
  );
  if (payment.verificationStatus === "VERIFIED" || payment.verificationStatus === "REJECTED") {
    return <p>Final decision: {payment.verificationStatus}</p>;
  }

  return (
    <form action={action} className="inline-form">
      <input name="onboardingId" type="hidden" value={onboardingId} />
      <input name="expectedVersion" type="hidden" value={onboardingVersion} />
      <input name="paymentId" type="hidden" value={payment.id} />
      <input name="expectedPaymentVersion" type="hidden" value={payment.version} />
      <label>
        Decision
        <select name="decision">
          <option value="VERIFIED">Verify</option>
          <option value="REVIEW_REQUIRED">Review required</option>
          <option value="REJECTED">Reject</option>
        </select>
      </label>
      <label>
        Verified amount
        <input
          defaultValue={payment.originalAmount.replace(/^[A-Z]{3} /, "")}
          name="verifiedAmount"
        />
      </label>
      <label>
        Discrepancy or decision reason
        <input name="discrepancyReason" />
      </label>
      <button disabled={pending}>Save payment review</button>
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function PaymentControls(
  props: Readonly<{
    onboardingId: string;
    version: number;
    currency: string;
    recordingKey: string;
    invoice: Readonly<{
      invoiceNumber: string | null;
      status: string;
      totalAmount: string;
      dueAt: string | null;
      payments: readonly Payment[];
    }> | null;
    canIssue: boolean;
    canRecord: boolean;
    canReview: boolean;
  }>,
) {
  const [issueState, issueAction, issuePending] = useActionState(
    issueActivationInvoiceAction,
    initialCommercialActionState,
  );
  const [recordState, recordAction, recordPending] = useActionState(
    recordPaymentAction,
    initialCommercialActionState,
  );
  const hidden = (
    <>
      <input name="onboardingId" type="hidden" value={props.onboardingId} />
      <input name="expectedVersion" type="hidden" value={props.version} />
    </>
  );

  if (!props.invoice) return <p>No activation invoice exists.</p>;

  return (
    <div className="commercial-controls">
      <p>
        Activation invoice:{" "}
        <strong>
          {props.invoice.invoiceNumber ?? "Draft awaiting Finance"} · {props.invoice.totalAmount} ·{" "}
          {props.invoice.status}
        </strong>
      </p>
      {props.canIssue && props.invoice.status === "DRAFT" ? (
        <form action={issueAction} className="commercial-form compact-form">
          {hidden}
          <div className="form-grid">
            <label>
              Invoice number
              <input name="invoiceNumber" required />
            </label>
            <label>
              Due date
              <input name="dueAt" required type="date" />
            </label>
          </div>
          <button disabled={issuePending}>Issue activation invoice</button>
          {issueState.message ? (
            <p className="form-error" role="alert">
              {issueState.message}
            </p>
          ) : null}
        </form>
      ) : null}

      {props.canRecord && !["DRAFT", "CANCELLED"].includes(props.invoice.status) ? (
        <form action={recordAction} className="commercial-form compact-form">
          {hidden}
          <input name="recordingKey" type="hidden" value={props.recordingKey} />
          <input name="currency" type="hidden" value={props.currency} />
          <div className="form-grid">
            <label>
              Payment amount
              <input inputMode="decimal" name="originalAmount" required />
            </label>
            <label>
              Payment evidence/reference
              <input name="externalReference" />
            </label>
          </div>
          <button disabled={recordPending}>Record payment</button>
          {recordState.message ? (
            <p className="form-error" role="alert">
              {recordState.message}
            </p>
          ) : null}
        </form>
      ) : null}

      {props.invoice.payments.map((payment) => (
        <article className="payment-review-card" key={payment.id}>
          <p>
            <strong>{payment.originalAmount}</strong> · {payment.verificationStatus}
          </p>
          {props.canReview ? (
            <PaymentReviewForm
              onboardingId={props.onboardingId}
              onboardingVersion={props.version}
              payment={payment}
            />
          ) : null}
        </article>
      ))}
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";

import {
  correctSalesHandoffAction,
  createSalesHandoffAction,
} from "@/app/(dashboard)/onboardings/actions";
import { initialCommercialActionState } from "@/application/commercial/action-state";

type Option = Readonly<{ id: string; name: string }>;

type HandoffDefaults = Readonly<{
  onboardingId: string;
  expectedVersion: number;
  externalDealId: string | null;
  clientMode: "EXISTING" | "NEW" | null;
  existingClientId: string | null;
  newClientCompanyName: string | null;
  newClientContactName: string | null;
  newClientContactEmail: string | null;
  newClientContactPhone: string | null;
  servicePackageId: string | null;
  dealStatus: string | null;
  agreedTotal: string | null;
  currency: string | null;
  salesNotes: string | null;
  validationErrors: unknown;
}>;

export function SalesHandoffForm({
  submissionKey,
  clients,
  packages,
  defaults,
}: Readonly<{
  submissionKey: string;
  clients: readonly Option[];
  packages: readonly Option[];
  defaults?: HandoffDefaults;
}>) {
  const [clientMode, setClientMode] = useState(defaults?.clientMode ?? "EXISTING");
  const action = defaults ? correctSalesHandoffAction : createSalesHandoffAction;
  const [state, formAction, pending] = useActionState(action, initialCommercialActionState);
  const storedErrors =
    defaults?.validationErrors &&
    typeof defaults.validationErrors === "object" &&
    !Array.isArray(defaults.validationErrors)
      ? (defaults.validationErrors as Record<string, string[]>)
      : {};
  const fieldError = (name: string) =>
    state.fieldErrors?.[name]?.[0] ?? storedErrors[name]?.[0] ?? null;

  return (
    <form action={formAction} className="commercial-form">
      <input name="submissionKey" type="hidden" value={submissionKey} />
      {defaults ? (
        <>
          <input name="onboardingId" type="hidden" value={defaults.onboardingId} />
          <input name="expectedVersion" type="hidden" value={defaults.expectedVersion} />
        </>
      ) : null}

      <label>
        External deal reference
        <input
          defaultValue={defaults?.externalDealId ?? ""}
          name="externalDealId"
          placeholder="DEAL-2026-001"
        />
        {fieldError("externalDealId") ? (
          <small className="field-error">{fieldError("externalDealId")}</small>
        ) : null}
      </label>

      <fieldset>
        <legend>Client</legend>
        <label className="inline-choice">
          <input
            checked={clientMode === "EXISTING"}
            name="clientMode"
            onChange={() => setClientMode("EXISTING")}
            type="radio"
            value="EXISTING"
          />
          Select an existing client
        </label>
        <label className="inline-choice">
          <input
            checked={clientMode === "NEW"}
            name="clientMode"
            onChange={() => setClientMode("NEW")}
            type="radio"
            value="NEW"
          />
          Enter a new client
        </label>

        {clientMode === "EXISTING" ? (
          <label>
            Existing client
            <select defaultValue={defaults?.existingClientId ?? ""} name="existingClientId">
              <option value="">Select a client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
            {fieldError("existingClientId") ? (
              <small className="field-error">{fieldError("existingClientId")}</small>
            ) : null}
          </label>
        ) : (
          <div className="form-grid">
            <label>
              New company name
              <input
                defaultValue={defaults?.newClientCompanyName ?? ""}
                name="newClientCompanyName"
              />
              {fieldError("newClientCompanyName") ? (
                <small className="field-error">{fieldError("newClientCompanyName")}</small>
              ) : null}
            </label>
            <label>
              New client contact name
              <input
                defaultValue={defaults?.newClientContactName ?? ""}
                name="newClientContactName"
              />
              {fieldError("newClientContactName") ? (
                <small className="field-error">{fieldError("newClientContactName")}</small>
              ) : null}
            </label>
            <label>
              New client contact email
              <input
                defaultValue={defaults?.newClientContactEmail ?? ""}
                name="newClientContactEmail"
                type="email"
              />
              {fieldError("newClientContactEmail") ? (
                <small className="field-error">{fieldError("newClientContactEmail")}</small>
              ) : null}
            </label>
            <label>
              New client contact phone
              <input
                defaultValue={defaults?.newClientContactPhone ?? ""}
                name="newClientContactPhone"
              />
            </label>
          </div>
        )}
      </fieldset>

      <div className="form-grid">
        <label>
          Purchased package
          <select defaultValue={defaults?.servicePackageId ?? ""} name="servicePackageId">
            <option value="">Select an active package</option>
            {packages.map((servicePackage) => (
              <option key={servicePackage.id} value={servicePackage.id}>
                {servicePackage.name}
              </option>
            ))}
          </select>
          {fieldError("servicePackageId") ? (
            <small className="field-error">{fieldError("servicePackageId")}</small>
          ) : null}
        </label>
        <label>
          Deal status
          <select defaultValue={defaults?.dealStatus ?? "CLOSED_WON"} name="dealStatus">
            <option value="OPEN">Open</option>
            <option value="CLOSED_WON">Closed won</option>
            <option value="CLOSED_LOST">Closed lost</option>
          </select>
        </label>
        <label>
          Agreed total
          <input
            defaultValue={defaults?.agreedTotal ?? ""}
            inputMode="decimal"
            name="agreedTotal"
            placeholder="10000.00"
          />
          {fieldError("agreedTotal") ? (
            <small className="field-error">{fieldError("agreedTotal")}</small>
          ) : null}
        </label>
        <label>
          Currency
          <input defaultValue={defaults?.currency ?? "USD"} maxLength={3} name="currency" />
          {fieldError("currency") ? (
            <small className="field-error">{fieldError("currency")}</small>
          ) : null}
        </label>
      </div>

      <label>
        Relevant sales notes
        <textarea defaultValue={defaults?.salesNotes ?? ""} name="salesNotes" rows={4} />
      </label>
      {state.message ? (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      ) : null}
      <button disabled={pending} type="submit">
        {pending ? "Saving…" : defaults ? "Correct handoff" : "Submit sales handoff"}
      </button>
    </form>
  );
}

export type DomainErrorCode =
  | "ACCESS_DENIED"
  | "ACTIVATION_BLOCKED"
  | "CONFIGURATION_ERROR"
  | "DUPLICATE_CLIENT"
  | "DUPLICATE_EXTERNAL_DEAL"
  | "DUPLICATE_INVOICE_NUMBER"
  | "DUPLICATE_RECORDING_KEY"
  | "AUTOMATION_CONTEXT_DENIED"
  | "AUTOMATION_EVENT_CONFLICT"
  | "AUTOMATION_RUN_CONFLICT"
  | "CLAIM_REQUEST_CONFLICT"
  | "INVALID_EVENT_INTEGRITY"
  | "INVALID_EVENT_SCHEMA"
  | "INVALID_INPUT"
  | "INVALID_TRANSITION"
  | "LEASE_EXPIRED"
  | "MISSING_BUSINESS_CONFIGURATION"
  | "NOT_FOUND"
  | "PAYMENT_DECISION_CONFLICT"
  | "UNSUPPORTED_EVENT_TYPE"
  | "VERSION_CONFLICT";

export type DomainError = Readonly<{
  code: DomainErrorCode;
  message: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;

export type Result<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: DomainError }>;

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure<T = never>(
  code: DomainErrorCode,
  message: string,
  fieldErrors?: Readonly<Record<string, readonly string[]>>,
): Result<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
    },
  };
}

import { ApiError } from "@/lib/api";
import { parseApiFormErrors } from "@/lib/form-errors";

export interface ServerFormErrors { fields: Record<string, string>; form: string | null }

/**
 * Turns an API failure into per-field messages (only for serializer validation errors) plus a form-level message.
 * Domain errors such as REFUND_NOT_ALLOWED carry `details` that are NOT field messages (e.g. `{refundable: "12.00"}`),
 * so for those we show the server's own sentence and nothing else.
 */
export function serverFormErrors(err: unknown, fields: readonly string[]): ServerFormErrors {
  if (err instanceof ApiError && err.code === "VALIDATION_ERROR") return parseApiFormErrors(err, { fields });
  if (err instanceof ApiError) return { fields: {}, form: err.requestId ? `${err.message} (reference ${err.requestId})` : err.message };
  if (err) return { fields: {}, form: "Something went wrong. Please try again." };
  return { fields: {}, form: null };
}

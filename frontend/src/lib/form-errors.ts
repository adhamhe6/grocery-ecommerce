// Turns the API's error contract into form-friendly pieces.
//
// The API answers validation failures with { error: { code: "VALIDATION_ERROR", message, details } } where `details` is
//   - an object  { field: ["msg", ...], non_field_errors: ["msg"] }   (serializer validation), or
//   - an array   ["msg", ...]                                            (password rules raised from inside a view)
// Domain errors (wrong password, rate limits, …) carry a message and usually no per-field details.

import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError } from "./api";

export interface ParsedFormErrors {
  /** Field name -> message (several messages are joined with a space). */
  fields: Record<string, string>;
  /** Something that doesn't belong to a single field; null when the field messages say everything. */
  form: string | null;
}

export interface ParseOptions {
  /** Field names the form actually has. Messages for any other key are shown at form level instead of being lost. */
  fields?: readonly string[];
  /** Where to put `non_field_errors` / array details. Without it they are shown at form level. */
  nonFieldTo?: string;
}

const GENERIC = "Something went wrong. Please try again.";

/** "about 3 minutes" from the API's `retry_after` seconds. */
export function waitText(seconds: number): string {
  if (seconds < 90) return "a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round(seconds / 3600);
  return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

function collect(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(collect);
  if (value && typeof value === "object") return Object.values(value).flatMap(collect);
  return []; // numbers such as retry_after are not messages
}

export function parseApiFormErrors(err: unknown, opts: ParseOptions = {}): ParsedFormErrors {
  if (!(err instanceof ApiError)) return { fields: {}, form: GENERIC };

  const fields: Record<string, string> = {};
  const formMessages: string[] = [];
  const put = (target: string | undefined, msgs: string[]) => {
    if (msgs.length === 0) return;
    if (target) fields[target] = [fields[target], ...msgs].filter(Boolean).join(" ");
    else formMessages.push(...msgs);
  };

  const details: unknown = err.details;
  if (Array.isArray(details)) {
    put(opts.nonFieldTo, collect(details));
  } else if (details && typeof details === "object") {
    for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
      const msgs = collect(value);
      if (key === "non_field_errors" || key === "detail") put(opts.nonFieldTo, msgs);
      else if (opts.fields && !opts.fields.includes(key)) put(undefined, msgs);
      else put(key, msgs);
    }
  }

  if (formMessages.length > 0) return { fields, form: formMessages.join(" ") };
  if (Object.keys(fields).length > 0) return { fields, form: null };
  let message = err.message || GENERIC;
  const retry = err.code === "RATE_LIMITED" && !Array.isArray(details) ? Number((details as Record<string, unknown> | undefined)?.retry_after) : NaN;
  if (Number.isFinite(retry) && retry > 0) message = `${message} You can try again in ${waitText(retry)}.`;
  return { fields, form: message };
}

/** Applies parsed API errors to a react-hook-form instance and focuses the first field that has one. */
export function applyApiErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  setForm: (message: string | null) => void,
  opts: ParseOptions = {},
): ParsedFormErrors {
  const parsed = parseApiFormErrors(err, opts);
  let first = true;
  for (const [name, message] of Object.entries(parsed.fields)) {
    setError(name as Path<T>, { type: "server", message }, { shouldFocus: first });
    first = false;
  }
  setForm(parsed.form);
  return parsed;
}

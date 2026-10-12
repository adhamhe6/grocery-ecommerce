// Browser-side API client. Same-origin (/api is proxied to Django), session cookie + CSRF header.

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  requestId?: string;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
  /** Field-level messages for form libraries: { "email": "Already exists", "contact.phone": "Required" } */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.details ?? {})) {
      if (Array.isArray(v) && typeof v[0] === "string") out[k] = v[0];
      else if (typeof v === "string") out[k] = v;
    }
    return out;
  }
}

const BASE = "/api/v1";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

let csrfInFlight: Promise<void> | null = null;
async function ensureCsrf(): Promise<string | null> {
  const existing = readCookie("csrftoken");
  if (existing) return existing;
  csrfInFlight ??= fetch(`${BASE}/auth/csrf/`, { credentials: "same-origin" }).then(() => undefined).finally(() => { csrfInFlight = null; });
  await csrfInFlight;
  return readCookie("csrftoken");
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined | (string | number)[]>;
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export function buildQuery(query?: RequestOptions["query"]): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (method !== "GET") {
    const token = await ensureCsrf();
    if (token) headers["X-CSRFToken"] = token;
  }
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${buildQuery(opts.query)}`, { method, headers, body, credentials: "same-origin", signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK_ERROR", "We couldn't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? "Something went wrong. Please try again.", err?.details ?? {}, err?.request_id);
  }
  return data as T;
}

export const apiGet = <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) => api<T>(path, { query, signal });
export const apiPost = <T>(path: string, body?: unknown, opts: Omit<RequestOptions, "method" | "body"> = {}) => api<T>(path, { ...opts, method: "POST", body });
export const apiPatch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
export const apiPut = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
export const apiDelete = <T>(path: string) => api<T>(path, { method: "DELETE" });

/** A stable-per-attempt key so a double click or a retry can never create two orders. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

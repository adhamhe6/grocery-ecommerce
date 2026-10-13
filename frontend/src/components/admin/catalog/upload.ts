// Multipart upload with progress. `fetch` cannot report upload progress, so this uses XMLHttpRequest; it speaks the same
// session-cookie + CSRF contract and error envelope as `src/lib/api.ts`.
import { ApiError } from "@/lib/api";

/** Turns a finished HTTP response into data or an `ApiError` (shared by uploads and tested on its own). */
export function parseApiResponse<T>(status: number, text: string): T {
  if (status === 204) return undefined as T;
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (status >= 200 && status < 300) return data as T;
  const err = data?.error;
  throw new ApiError(status, err?.code ?? "ERROR", err?.message ?? "Something went wrong. Please try again.", err?.details ?? {}, err?.request_id);
}

function csrfCookie(): string | null {
  const m = typeof document === "undefined" ? null : document.cookie.match(/(?:^|; )csrftoken=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function csrfToken(): Promise<string | null> {
  const existing = csrfCookie();
  if (existing) return existing;
  await fetch("/api/v1/auth/csrf/", { credentials: "same-origin" }).catch(() => undefined);
  return csrfCookie();
}

/** POST `form` to `/api/v1/admin{path}`; `onProgress` receives 0–100 while the bytes go up. */
export async function uploadMultipart<T = any>(path: string, form: FormData, opts: { onProgress?: (pct: number) => void; method?: "POST" | "PUT" } = {}): Promise<T> {
  const token = await csrfToken();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? "POST", `/api/v1/admin${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    if (token) xhr.setRequestHeader("X-CSRFToken", token);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "We couldn't reach the server. Check your connection and try again."));
    xhr.onabort = () => reject(new ApiError(0, "ABORTED", "The upload was cancelled."));
    xhr.onload = () => {
      try {
        opts.onProgress?.(100);
        resolve(parseApiResponse<T>(xhr.status, xhr.responseText));
      } catch (e) {
        reject(e);
      }
    };
    xhr.send(form);
  });
}

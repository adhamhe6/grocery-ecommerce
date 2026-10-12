// Post-login redirect targets (`?next=`). Only same-site relative paths are ever returned.

const PLACEHOLDER_ORIGIN = "http://orchardrow.invalid";
const DEFAULT_NEXT = "/account";

/** Pages that must never be the destination of a redirect after signing in (they would just bounce the shopper around). */
const AUTH_PATHS = new Set(["/login", "/register", "/forgot-password", "/reset-password", "/account/reset-password"]);

/**
 * Returns `raw` as a safe, normalised same-site path (with query and hash), or `fallback`.
 *
 * Rejects absolute URLs, protocol-relative URLs (`//host`), backslash tricks (`/\host`), control characters
 * (a tab or newline inside `//` is stripped by browsers), `javascript:` and friends, and anything that normalises
 * to a different origin or to `//…` once dot-segments are resolved (`/.//host`, `/%2e%2e//host`).
 */
export function safeNextPath(raw: unknown, fallback: string = DEFAULT_NEXT): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return fallback;
  if (raw[0] !== "/" || raw[1] === "/" || raw[1] === "\\") return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  const path = url.pathname;
  if (path.startsWith("//")) return fallback; // dot-segments collapsed into a protocol-relative URL
  const bare = path.replace(/\/+$/, "") || "/";
  if (AUTH_PATHS.has(bare) || path.startsWith("/api/") || path.startsWith("/_next/")) return fallback;
  return path + url.search + url.hash;
}

/** `/login` with the page the shopper was trying to reach. The target is validated again when it is used. */
export function loginHref(next: string): string {
  const safe = safeNextPath(next, "");
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

/** Keeps `?next=` when moving between login, register and forgot-password. */
export function withNext(path: string, next: string): string {
  return next && next !== DEFAULT_NEXT ? `${path}?next=${encodeURIComponent(next)}` : path;
}

import "server-only";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ApiError, buildQuery, type RequestOptions } from "./api";
import type { StoreConfig } from "./types";

const BACKEND = process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000";

/** Public-data fetch for Server Components. Never forwards cookies, so responses are safe to cache. */
export async function serverGet<T>(path: string, query?: RequestOptions["query"], opts: { revalidate?: number | false; tags?: string[] } = {}): Promise<T> {
  const url = `${BACKEND}/api/v1${path}${buildQuery(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: opts.revalidate ?? 30, tags: opts.tags } });
  if (res.status === 404) notFound();
  if (!res.ok) {
    let body: any = null;
    try {
      body = await res.json();
    } catch {}
    throw new ApiError(res.status, body?.error?.code ?? "ERROR", body?.error?.message ?? `Request failed (${res.status})`, body?.error?.details ?? {});
  }
  return (await res.json()) as T;
}

export async function getStore(): Promise<StoreConfig> {
  return serverGet<StoreConfig>("/store/", undefined, { revalidate: 60, tags: ["store"] });
}

/** The shopper's chosen store for availability (cookie set by the store selector). */
export async function selectedBranch(): Promise<number | undefined> {
  const jar = await cookies();
  const v = jar.get("gc_branch")?.value;
  return v && /^\d+$/.test(v) ? Number(v) : undefined;
}

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

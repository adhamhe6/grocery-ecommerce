"use client";

// Shared plumbing for the staff dashboard: permissions, branch scope, list/mutation helpers.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { ApiError, api, apiGet, buildQuery, type RequestOptions } from "./api";
import { useToast } from "@/components/ui/toast";

export interface AdminPermissions {
  id: number;
  email: string;
  full_name: string;
  role: string;
  role_label: string;
  capabilities: string[];
  branch_scope: { global: boolean; branch_ids: number[] | null; branches: { id: number; code: string; name: string }[] };
}

export interface AdminCtx {
  perms: AdminPermissions;
  can: (...caps: string[]) => boolean; // true when the user has ALL listed capabilities
  canAny: (...caps: string[]) => boolean;
  branches: AdminPermissions["branch_scope"]["branches"];
  /** The store the dashboard is currently looking at; null = every store the user may see. */
  branchId: number | null;
  setBranchId: (id: number | null) => void;
  branchName: (id: number | null | undefined) => string;
}

const Ctx = React.createContext<AdminCtx | null>(null);
const BRANCH_KEY = "orchardrow.admin.branch";

export function AdminProvider({ perms, children }: { perms: AdminPermissions; children: React.ReactNode }) {
  const [branchId, setBranchState] = React.useState<number | null>(null);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(BRANCH_KEY);
      const id = raw ? Number(raw) : null;
      if (id && perms.branch_scope.branches.some((b) => b.id === id)) setBranchState(id);
      else if (!perms.branch_scope.global && perms.branch_scope.branches.length === 1) setBranchState(perms.branch_scope.branches[0].id);
    } catch { /* storage may be unavailable */ }
  }, [perms]);
  const value = React.useMemo<AdminCtx>(() => {
    const caps = new Set(perms.capabilities);
    return {
      perms,
      can: (...c) => c.every((x) => caps.has(x)),
      canAny: (...c) => c.some((x) => caps.has(x)),
      branches: perms.branch_scope.branches,
      branchId,
      setBranchId: (id) => {
        setBranchState(id);
        try { id ? localStorage.setItem(BRANCH_KEY, String(id)) : localStorage.removeItem(BRANCH_KEY); } catch { /* ignore */ }
      },
      branchName: (id) => perms.branch_scope.branches.find((b) => b.id === id)?.name ?? "—",
    };
  }, [perms, branchId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useAdmin must be used inside the admin shell");
  return v;
}

export function useAdminPermissions() {
  return useQuery({ queryKey: ["admin", "perms"], queryFn: () => apiGet<AdminPermissions>("/admin/me/permissions/"), staleTime: 5 * 60_000, retry: false });
}

// ---------------------------------------------------------------------------------------------- data helpers
export type Params = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

/** Admin endpoints return either a bare array or the standard paginated envelope; this normalises both. */
export interface ListResult<T> { rows: T[]; count: number; page: number; totalPages: number; paginated: boolean }
export function normaliseList<T>(data: unknown): ListResult<T> {
  if (Array.isArray(data)) return { rows: data as T[], count: data.length, page: 1, totalPages: 1, paginated: false };
  const d = data as { results?: T[]; count?: number; page?: number; total_pages?: number } | null;
  const rows = d?.results ?? [];
  return { rows, count: d?.count ?? rows.length, page: d?.page ?? 1, totalPages: d?.total_pages ?? 1, paginated: true };
}

/** GET /api/v1/admin{path}. Query key is ["admin", path, params] so mutations can invalidate by path prefix. */
export function useAdminList<T = Record<string, any>>(path: string, params: Params = {}, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  const q = useQuery({
    queryKey: ["admin", path, params],
    queryFn: ({ signal }) => apiGet<unknown>(`/admin${path}`, params, signal),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval,
    placeholderData: (prev) => prev,
    staleTime: 10_000,
  });
  const list = React.useMemo(() => normaliseList<T>(q.data), [q.data]);
  return { ...list, isLoading: q.isLoading, isFetching: q.isFetching, error: q.error, refetch: q.refetch, raw: q.data };
}

export function useAdminGet<T = Record<string, any>>(path: string, params: Params = {}, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({ queryKey: ["admin", path, params], queryFn: ({ signal }) => apiGet<T>(`/admin${path}`, params, signal), enabled: opts.enabled ?? true, refetchInterval: opts.refetchInterval, staleTime: 10_000 });
}

/**
 * Mutation against an admin endpoint. Shows a toast on error, and on success invalidates every cached admin query
 * whose path starts with one of `invalidate` (default: everything under "admin").
 */
export function useAdminAction<TData = any, TVars = any>(
  fn: (vars: TVars) => Promise<TData>,
  opts: { invalidate?: string[]; success?: string | ((d: TData) => string | undefined); onSuccess?: (d: TData, v: TVars) => void; onError?: (e: unknown) => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    onSuccess: (d, v) => {
      const prefixes = opts.invalidate;
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" && (!prefixes || prefixes.some((p) => String(q.queryKey[1] ?? "").startsWith(p))) });
      const msg = typeof opts.success === "function" ? opts.success(d) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(d, v);
    },
    onError: (e) => {
      toast.error(e);
      opts.onError?.(e);
    },
  });
}

export const adminRequest = <T = any,>(method: NonNullable<RequestOptions["method"]>, path: string, body?: unknown, query?: Params) =>
  api<T>(`/admin${path}`, { method, body, query });

export function adminCsvUrl(path: string, params: Params): string {
  return `/api/v1/admin${path}${buildQuery({ ...params, export: "csv" })}`;
}

export function fieldErrorsOf(e: unknown): Record<string, string> {
  return e instanceof ApiError ? e.fieldErrors : {};
}

/** Today in ISO form, local to the browser — used as a default for report ranges. */
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const daysAgo = (n: number) => isoDate(new Date(Date.now() - n * 86_400_000));

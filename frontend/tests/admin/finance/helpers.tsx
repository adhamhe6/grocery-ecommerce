import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import * as React from "react";
import { vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { AdminProvider, type AdminPermissions } from "@/lib/admin";
import { StoreProvider } from "@/lib/hooks";
import type { StoreConfig } from "@/lib/types";

export const store = { name: "Orchard Row", currency: "USD", locale: "en-US", timezone: "UTC", payment: { mode: "demo", card_enabled: true, cod_enabled: true } } as StoreConfig;

export const perms = (over: Partial<AdminPermissions> = {}): AdminPermissions => ({
  id: 1, email: "boss@example.com", full_name: "Boss Person", role: "SUPER_ADMIN", role_label: "Super admin",
  capabilities: ["orders.refund", "finance.read", "staff.manage", "settings.manage"],
  branch_scope: { global: true, branch_ids: null, branches: [{ id: 1, code: "CEN", name: "Central" }, { id: 2, code: "NTH", name: "North" }] },
  ...over,
});

export function renderAdmin(ui: React.ReactElement, p: AdminPermissions = perms()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  return render(
    <StoreProvider store={store}>
      <QueryClientProvider client={client}>
        <ToastProvider><AdminProvider perms={p}>{ui}</AdminProvider></ToastProvider>
      </QueryClientProvider>
    </StoreProvider>,
  );
}

type Reply = { status?: number; json?: unknown };
type Handler = (req: { body: any; n: number }) => Reply;

/** Replaces fetch. Routes are "METHOD /path" (after /api/v1, query ignored); a function route gets the body and a per-route call counter. */
export function mockApi(routes: Record<string, Handler | Reply>) {
  document.cookie = "csrftoken=test-token";
  const calls: { key: string; body: any; url: string }[] = [];
  const counts: Record<string, number> = {};
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname.replace(/^\/api\/v1/, "")}`;
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ key, body, url: url.toString() });
    counts[key] = (counts[key] ?? 0) + 1;
    const route = routes[key];
    if (!route) throw new Error(`Unmocked request: ${key}`);
    const res = typeof route === "function" ? route({ body, n: counts[key] }) : route;
    const status = res.status ?? 200;
    return new Response(status === 204 || res.json === undefined ? null : JSON.stringify(res.json), { status, headers: { "Content-Type": "application/json" } });
  }));
  return { calls, of: (key: string) => calls.filter((c) => c.key === key) };
}

export const apiError = (status: number, code: string, message: string, details: unknown = {}) => ({ status, json: { error: { code, message, details, request_id: "req-1" } } });

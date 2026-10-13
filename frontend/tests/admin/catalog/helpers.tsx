import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configure, render } from "@testing-library/react";
import * as React from "react";
import { vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { AdminProvider, type AdminPermissions } from "@/lib/admin";
import { StoreProvider } from "@/lib/hooks";
import type { StoreConfig } from "@/lib/types";

// The dashboard pages do several data fetches before they settle; give async queries room when the machine is busy.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });

export const store = { name: "Orchard Row", currency: "USD", locale: "en-US", timezone: "America/New_York" } as StoreConfig;

export const perms = (capabilities: string[]): AdminPermissions => ({
  id: 1, email: "admin@example.com", full_name: "Ada Admin", role: "ADMIN", role_label: "Admin", capabilities,
  branch_scope: { global: true, branch_ids: null, branches: [] },
});

export function renderAdmin(ui: React.ReactElement, capabilities = ["catalog.read", "catalog.write"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <StoreProvider store={store}><QueryClientProvider client={client}><ToastProvider><AdminProvider perms={perms(capabilities)}>{children}</AdminProvider></ToastProvider></QueryClientProvider></StoreProvider>
  );
  return { client, ...render(ui, { wrapper }) };
}

type Reply = { status?: number; json?: unknown };
type Handler = Reply | ((req: { url: URL; method: string; body: any }) => Reply);

/** Replaces `fetch`. Routes are "METHOD /admin/path" (without /api/v1, query string ignored). Unmatched calls fail loudly. */
export function mockApi(routes: Record<string, Handler>) {
  document.cookie = "csrftoken=test-token";
  const calls: { key: string; body: any }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname.replace(/^\/api\/v1/, "")}`;
    const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ key, body });
    const route = routes[key];
    if (!route) throw new Error(`Unmocked request: ${key}`);
    const res = typeof route === "function" ? route({ url, method, body }) : route;
    const status = res.status ?? 200;
    return new Response(status === 204 || res.json === undefined ? null : JSON.stringify(res.json), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fetch: fn };
}

export const apiError = (status: number, code: string, message: string, details: unknown = {}): Reply => ({ status, json: { error: { code, message, details, request_id: "req-1" } } });

export const CATEGORIES = [
  { id: 1, parent: null, name: "Fruit & veg", slug: "fruit-veg", description: "", image: {}, sort_order: 10, is_active: true, show_on_home: false, product_count: 0, active_product_count: 0, children_count: 1 },
  { id: 2, parent: 1, name: "Apples", slug: "apples", description: "", image: {}, sort_order: 10, is_active: true, show_on_home: false, product_count: 0, active_product_count: 0, children_count: 0 },
];
export const UNITS = [
  { id: 10, code: "each", name: "Each", symbol: "each", kind: "COUNT", allows_fraction: false },
  { id: 11, code: "kg", name: "Kilogram", symbol: "kg", kind: "WEIGHT", allows_fraction: true },
];
export const ALLERGENS = [{ id: 1, code: "milk", name: "Milk" }, { id: 2, code: "sesame", name: "Sesame" }];
export const lookupRoutes = (): Record<string, Handler> => ({
  "GET /admin/categories/": { json: CATEGORIES }, "GET /admin/brands/": { json: [] }, "GET /admin/units/": { json: UNITS }, "GET /admin/allergens/": { json: ALLERGENS },
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook } from "@testing-library/react";
import * as React from "react";
import { vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { StoreProvider, useCompare } from "@/lib/hooks";
import type { StoreConfig, User } from "@/lib/types";

export const store = { name: "Orchard Row", currency: "USD", locale: "en-US" } as StoreConfig;

export const user: User = {
  id: 1, email: "ada@example.com", full_name: "Ada Lovelace", phone: "", role: "CUSTOMER", is_staff_user: false,
  capabilities: [], branch_ids: [], marketing_opt_in: false, notify_order_emails: true,
};

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <StoreProvider store={store}><QueryClientProvider client={client}><ToastProvider>{children}</ToastProvider></QueryClientProvider></StoreProvider>
  );
  return { client, wrapper };
}

export function renderWithProviders(ui: React.ReactElement) {
  const { client, wrapper } = makeWrapper();
  return { client, ...render(ui, { wrapper }) };
}

/**
 * useCompare keeps its list in module state, so tests in one file would leak into each other. This drives the
 * real hook (clear, then toggle each id on) to put the shortlist in a known state. Call after mockApi().
 */
export function seedCompare(ids: number[]) {
  const { wrapper } = makeWrapper();
  const { result, unmount } = renderHook(() => useCompare(), { wrapper });
  act(() => result.current.clear());
  for (const id of ids) act(() => result.current.toggle(id));
  unmount();
}

type Handler = (req: { url: string; method: string; body: any }) => { status?: number; json?: unknown } | undefined;

/** Replaces global fetch. Routes are matched on "METHOD /path" (query string ignored). Unmatched calls fail loudly. */
export function mockApi(routes: Record<string, Handler | { status?: number; json?: unknown }>) {
  document.cookie = "csrftoken=test-token";
  const calls: { key: string; body: any }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname.replace(/^\/api\/v1/, "")}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const route = routes[key];
    if (!route) throw new Error(`Unmocked request: ${key}`);
    const res = typeof route === "function" ? route({ url: url.toString(), method, body }) ?? {} : route;
    const status = res.status ?? 200;
    return new Response(status === 204 || res.json === undefined ? null : JSON.stringify(res.json), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fetch: fn };
}

export const apiError = (status: number, code: string, message: string, details: unknown = {}) => ({ status, json: { error: { code, message, details, request_id: "req-1" } } });

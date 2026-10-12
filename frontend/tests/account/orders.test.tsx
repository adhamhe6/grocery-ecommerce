import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrdersView, ReorderResult } from "@/components/account/orders-view";
import { apiError, mockApi, renderWithProviders } from "./helpers";

const page = vi.hoisted(() => ({ value: "1" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/account/orders",
  useSearchParams: () => new URLSearchParams({ page: page.value }),
}));
afterEach(() => { vi.unstubAllGlobals(); page.value = "1"; });

const order = (n: string, over: Record<string, unknown> = {}) => ({
  number: n, status: "PICKING", status_label: "Being picked", placed_at: "2026-10-10T09:30:00Z", fulfilment_type: "DELIVERY", total: "42.50", currency: "USD",
  item_count: 5, slot_starts_at: "2026-10-12T16:00:00Z", payment_status: "PAID", ...over,
});
const list = (results: unknown[], over: Record<string, unknown> = {}) => ({ count: results.length, page: 1, page_size: 10, total_pages: 1, next: null, previous: null, results, ...over });

describe("OrdersView", () => {
  it("lists orders with status, total and a link to each order page", async () => {
    mockApi({ "GET /orders/": { json: list([order("OR-261010-ABCDE"), order("OR-261001-ZZZZZ", { status: "COMPLETED", status_label: "Completed", slot_starts_at: null })]) } });
    renderWithProviders(<OrdersView />);
    const link = await screen.findByRole("link", { name: "View order OR-261010-ABCDE" });
    expect(link).toHaveAttribute("href", "/orders/OR-261010-ABCDE");
    expect(screen.getByText("Being picked")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getAllByText("$42.50")).toHaveLength(2);
    expect(screen.getAllByText(/Delivery window starts/)).toHaveLength(1); // finished orders don't show a slot
  });

  it("has an honest empty state", async () => {
    mockApi({ "GET /orders/": { json: list([], { count: 0, total_pages: 1 }) } });
    renderWithProviders(<OrdersView />);
    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start shopping" })).toHaveAttribute("href", "/shop");
  });

  it("shows an error with a retry", async () => {
    mockApi({ "GET /orders/": apiError(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.") });
    renderWithProviders(<OrdersView />);
    expect(await screen.findByText("We couldn't load your orders")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("explains a page past the end instead of a generic error", async () => {
    page.value = "9";
    mockApi({ "GET /orders/": apiError(404, "NOT_FOUND", "The requested resource was not found.") });
    renderWithProviders(<OrdersView />);
    expect(await screen.findByText("That page doesn't exist")).toBeInTheDocument();
  });

  it("reorders and reports what was added, trimmed and left out", async () => {
    const api = mockApi({
      "GET /orders/": { json: list([order("OR-1")]) },
      "POST /cart/reorder/OR-1/": {
        json: {
          item_count: 2, lines: [], totals: {}, notices: [], can_checkout: true,
          reorder: {
            added: [{ name: "Bananas", quantity: "2.000" }, { name: "Oat milk", quantity: "2" }],
            adjusted: [{ name: "Oat milk", requested: "6.000", added: "2", reason: "Limited stock" }],
            skipped: [{ name: "Fresh basil", reason: "Out of stock right now" }],
          },
        },
      },
    });
    renderWithProviders(<OrdersView />);
    await userEvent.click(await screen.findByRole("button", { name: "Reorder OR-1" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Added 2 of 3 items from order OR-1")).toBeInTheDocument();
    expect(within(alert).getByText(/Oat milk: you ordered/)).toHaveTextContent("you ordered 6, we added 2. Limited stock.");
    expect(within(alert).getByText("Fresh basil: Out of stock right now")).toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: "View basket" })).toHaveAttribute("href", "/cart");
    expect(api.calls.some((c) => c.key === "POST /cart/reorder/OR-1/")).toBe(true);
  });
});

describe("ReorderResult", () => {
  it("says nothing was added when everything was skipped", () => {
    renderWithProviders(<ReorderResult number="OR-2" result={{ added: [], adjusted: [], skipped: [{ name: "Milk", reason: "This product is no longer available." }] }} onDismiss={() => {}} />);
    expect(screen.getByText("Nothing from order OR-2 could be added")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View basket" })).not.toBeInTheDocument();
  });

  it("confirms a clean reorder", () => {
    renderWithProviders(<ReorderResult number="OR-3" result={{ added: [{ name: "Milk", quantity: "1" }], adjusted: [], skipped: [] }} onDismiss={() => {}} />);
    expect(screen.getByText("Added all 1 item from order OR-3 to your basket")).toBeInTheDocument();
  });
});

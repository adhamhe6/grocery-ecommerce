import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FavoritesView } from "@/components/account/favorites-view";
import { card } from "./fixtures";
import { apiError, mockApi, renderWithProviders, user as me } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/account/favorites", useSearchParams: () => new URLSearchParams() }));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

const common = { "GET /auth/session/": { json: { user: me } }, "GET /cart/": { json: { item_count: 0, lines: [], totals: {}, notices: [], can_checkout: false } } };

describe("FavoritesView", () => {
  it("shows saved products as cards with an add-to-basket button", async () => {
    mockApi({ ...common, "GET /favorites/": { json: { ids: [5], products: [card({ id: 5, name: "Sourdough loaf" })] } } });
    renderWithProviders(<FavoritesView />);
    expect(await screen.findByRole("link", { name: "Sourdough loaf" })).toHaveAttribute("href", "/product/product-5");
    expect(screen.getByRole("button", { name: "Add Sourdough loaf to basket" })).toBeInTheDocument();
  });

  it("is honest about saved products that can't be shown, and can remove them", async () => {
    const api = mockApi({ ...common, "GET /favorites/": { json: { ids: [5, 9], products: [card({ id: 5, name: "Sourdough loaf" })] } }, "DELETE /favorites/9/": { status: 204 } });
    renderWithProviders(<FavoritesView />);
    expect(await screen.findByText("1 saved product can't be shown")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove it from favourites" }));
    await vi.waitFor(() => expect(api.calls.some((c) => c.key === "DELETE /favorites/9/")).toBe(true));
  });

  it("explains how to save a favourite when there are none", async () => {
    mockApi({ ...common, "GET /favorites/": { json: { ids: [], products: [] } } });
    renderWithProviders(<FavoritesView />);
    expect(await screen.findByText("No favourites yet")).toBeInTheDocument();
  });

  it("shows an error state", async () => {
    mockApi({ ...common, "GET /favorites/": apiError(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.") });
    renderWithProviders(<FavoritesView />);
    expect(await screen.findByText("We couldn't load your favourites")).toBeInTheDocument();
  });
});

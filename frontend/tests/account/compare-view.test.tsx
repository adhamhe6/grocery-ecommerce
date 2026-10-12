import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareView } from "@/components/compare/compare-view";
import { apiError, mockApi, renderWithProviders, seedCompare } from "./helpers";
import { card, compareProduct, detail, response } from "./fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/compare", useSearchParams: () => new URLSearchParams() }));

const KEY = "orchardrow.compare";
const milk = compareProduct({ card: card({ id: 1, name: "Whole milk", slug: "whole-milk", price: "1.20", base_price: "1.20", unit_price: { amount: "1.20", per: "L" }, pack_label: "each · 1 L" }), brand: "Dairy Co", size: "1 L", origin: "Ireland", storage: "Chilled", nutrition_per_100: { energy_kcal: "64.0", sugars: "4.7", protein: "3.4", basis: "per 100 ml" } });
const oat = compareProduct({ card: card({ id: 2, name: "Oat drink", slug: "oat-drink", price: "1.80", base_price: "1.80", unit_price: { amount: "1.80", per: "L" }, pack_label: "each · 1 L", availability: { status: "OUT_OF_STOCK", max_orderable: null, can_order: false } }), size: "1 L" });

const baseRoutes = {
  "GET /auth/session/": { json: { user: null } },
  "GET /cart/": { json: { item_count: 0, lines: [], totals: {}, notices: [], can_checkout: false } },
  "GET /products/whole-milk/": { json: detail({ id: 1, slug: "whole-milk", allergens: { contains: ["Milk"], may_contain: [], confirmed: true }, storage_instructions: "Keep refrigerated" }) },
  "GET /products/oat-drink/": { json: detail({ id: 2, slug: "oat-drink", allergens: { contains: [], may_contain: [], confirmed: false } }) },
};

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe("CompareView", () => {
  it("shows an empty state with a way back to the shop when nothing is chosen", async () => {
    const api = mockApi(baseRoutes);
    seedCompare([]);
    renderWithProviders(<CompareView />);
    expect(await screen.findByText("Nothing to compare yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the shop" })).toHaveAttribute("href", "/shop");
    expect(api.calls.some((c) => c.key === "GET /compare/")).toBe(false);
  });

  it("asks the API for exactly the chosen ids and renders an accessible table", async () => {
    const api = mockApi({ ...baseRoutes, "GET /compare/": { json: response([milk, oat], { best_value_id: 1 }) } });
    seedCompare([1, 2]);
    renderWithProviders(<CompareView />);
    const table = await screen.findByRole("table");
    expect(api.fetch.mock.calls.some(([u]) => String(u).includes("/compare/?ids=1%2C2"))).toBe(true);
    expect(within(table).getByRole("columnheader", { name: /Whole milk/ })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /Oat drink/ })).toBeInTheDocument();
    const unit = within(table).getByRole("row", { name: /Unit price/ });
    expect(within(unit).getByText("Best value")).toBeInTheDocument();
    // row headers are real <th scope=row> so a screen reader announces the feature with each value
    expect(within(table).getByRole("rowheader", { name: "Price" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Scroll sideways/ })).toHaveAttribute("tabindex", "0");
  });

  it("marks anything missing as 'Not provided' and never shows a bare zero", async () => {
    mockApi({ ...baseRoutes, "GET /compare/": { json: response([milk, oat]) } });
    seedCompare([1, 2]);
    renderWithProviders(<CompareView />);
    const table = await screen.findByRole("table");
    await waitFor(() => expect(within(table).queryAllByText("Loading")).toHaveLength(0));
    const brand = within(table).getByRole("row", { name: /Brand/ });
    expect(within(brand).getByText("Dairy Co")).toBeInTheDocument();
    expect(within(brand).getByText("Not provided")).toBeInTheDocument();
    const allergens = within(table).getByRole("row", { name: /Allergens/ });
    expect(within(allergens).getByText("Contains Milk")).toBeInTheDocument();
    expect(within(allergens).getByText(/Not confirmed. Check the packaging/)).toBeInTheDocument();
    const energy = within(table).getByRole("row", { name: /Energy/ });
    expect(within(energy).getByText("64 kcal")).toBeInTheDocument();
    expect(within(energy).getByText("Not provided")).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Availability/ })).toHaveTextContent("Out of stock");
  });

  it("removes a product with its own labelled button and clears the whole list", async () => {
    mockApi({ ...baseRoutes, "GET /compare/": ({ url }) => ({ json: response(new URL(url).searchParams.get("ids") === "1" ? [milk] : [milk, oat]) }) });
    seedCompare([1, 2]);
    renderWithProviders(<CompareView />);
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Remove Oat drink from comparison" }));
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: /Oat drink/ })).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([1]);
    expect(screen.getByText(/Add at least one more product/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear comparison" }));
    expect(await screen.findByText("Nothing to compare yet")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([]);
  });

  it("drops products that are no longer on sale and says so", async () => {
    mockApi({ ...baseRoutes, "GET /compare/": ({ url }) => ({ json: response([milk, oat].filter((p) => new URL(url).searchParams.get("ids")!.split(",").includes(String(p.card.id)))) }) });
    seedCompare([1, 2, 3]);
    renderWithProviders(<CompareView />);
    expect(await screen.findByText("A product was removed from your comparison because it isn't available any more.")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([1, 2]);
  });

  it("surfaces the API's warnings", async () => {
    mockApi({ ...baseRoutes, "GET /compare/": { json: response([milk, oat], { unit_price_comparable: false, warnings: ["These products are measured differently (weight vs volume), so unit prices can't be compared."] }) } });
    seedCompare([1, 2]);
    renderWithProviders(<CompareView />);
    expect(await screen.findByText(/measured differently/)).toBeInTheDocument();
  });

  it("shows an error with retry when the comparison can't load", async () => {
    mockApi({ ...baseRoutes, "GET /compare/": apiError(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.") });
    seedCompare([1, 2]);
    renderWithProviders(<CompareView />);
    expect(await screen.findByText("We couldn't load your comparison")).toBeInTheDocument();
  });
});

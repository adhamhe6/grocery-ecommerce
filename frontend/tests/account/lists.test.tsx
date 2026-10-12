import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListBasketResult, ListsView } from "@/components/account/lists-view";
import { apiError, mockApi, renderWithProviders } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/account/lists", useSearchParams: () => new URLSearchParams() }));
afterEach(() => vi.unstubAllGlobals());

const weekly = { id: 7, name: "Weekly shop", items: [{ product_id: 11, name: "Oat milk", slug: "oat-milk", quantity: "1E+1" }, { product_id: 12, name: "Basil", slug: "basil", quantity: "0.5" }] };

describe("ListsView", () => {
  it("shows an empty state, and creates a list through the API", async () => {
    let lists: unknown[] = [];
    const api = mockApi({ "GET /lists/": () => ({ json: lists }), "POST /lists/": ({ body }) => { lists = [{ id: 1, name: body.name, items: [] }]; return { status: 201, json: lists[0] }; } });
    renderWithProviders(<ListsView />);
    await userEvent.click(await screen.findByRole("button", { name: /Create your first list/ }));
    const dialog = await screen.findByRole("dialog", { name: "New shopping list" });
    await userEvent.type(within(dialog).getByLabelText("List name"), "  Weekly shop ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create list" }));
    await waitFor(() => expect(screen.getByText("Weekly shop")).toBeInTheDocument());
    expect(api.calls.find((c) => c.key === "POST /lists/")?.body).toEqual({ name: "Weekly shop" });
  });

  it("shows the API's duplicate-name error on the name field", async () => {
    mockApi({ "GET /lists/": { json: [] }, "POST /lists/": apiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { name: ["You already have a list with this name."] }) });
    renderWithProviders(<ListsView />);
    await userEvent.click(await screen.findByRole("button", { name: /Create your first list/ }));
    await userEvent.type(await screen.findByLabelText("List name"), "Weekly shop");
    await userEvent.click(screen.getByRole("button", { name: "Create list" }));
    expect(await screen.findByText("You already have a list with this name.")).toBeInTheDocument();
  });

  it("opens a lone list by default and reads quantities the API sends as '1E+1' correctly", async () => {
    mockApi({ "GET /lists/": { json: [weekly] } });
    renderWithProviders(<ListsView />);
    expect(await screen.findByLabelText("Quantity of Oat milk")).toHaveValue(10);
    expect(screen.getByLabelText("Quantity of Basil")).toHaveValue(0.5);
  });

  it("saves a changed quantity with PUT and keeps invalid input from being sent", async () => {
    const api = mockApi({ "GET /lists/": { json: [weekly] }, "PUT /lists/7/items/12/": ({ body }) => ({ json: { ...weekly, items: [weekly.items[0], { ...weekly.items[1], quantity: body.quantity }] } }) });
    renderWithProviders(<ListsView />);
    const qty = await screen.findByLabelText("Quantity of Basil");
    await userEvent.clear(qty);
    await userEvent.type(qty, "0");
    expect(screen.getByText("Enter a quantity above zero.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await userEvent.clear(qty);
    await userEvent.type(qty, "2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "PUT /lists/7/items/12/")?.body).toEqual({ quantity: "2" }));
  });

  it("adds everything to the basket and reports what was skipped and why", async () => {
    mockApi({
      "GET /lists/": { json: [weekly] },
      "POST /lists/7/add-to-cart/": { json: { item_count: 1, lines: [], totals: {}, notices: [], can_checkout: true, list_result: { added: ["Oat milk"], skipped: [{ name: "Basil", reason: "Out of stock right now" }] } } },
    });
    renderWithProviders(<ListsView />);
    await userEvent.click(await screen.findByRole("button", { name: "Add all to basket" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Added 1 of 2 products from “Weekly shop”")).toBeInTheDocument();
    expect(within(alert).getByText("Basil: Out of stock right now")).toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: "View basket" })).toHaveAttribute("href", "/cart");
  });

  it("searches the catalogue to add a product (and won't add one twice)", async () => {
    const card = { id: 12, name: "Basil", slug: "basil", pack_label: "each", price: "1.20", image: null, quantity: { min: "1", step: "1", max: null }, availability: { status: "IN_STOCK", can_order: true, max_orderable: null } };
    const fresh = { ...card, id: 13, name: "Basil pesto", slug: "basil-pesto" };
    const api = mockApi({
      "GET /lists/": { json: [weekly] },
      "GET /products/": { json: { count: 2, page: 1, page_size: 6, total_pages: 1, next: null, previous: null, results: [card, fresh] } },
      "PUT /lists/7/items/13/": { json: { ...weekly, items: [...weekly.items, { product_id: 13, name: "Basil pesto", slug: "basil-pesto", quantity: "1" }] } },
    });
    renderWithProviders(<ListsView />);
    await userEvent.type(await screen.findByLabelText("Add a product"), "basil");
    expect(await screen.findByRole("button", { name: "Basil is already in Weekly shop" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Add Basil pesto to Weekly shop" }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "PUT /lists/7/items/13/")?.body).toEqual({ quantity: "1" }));
  });
});

describe("ListBasketResult", () => {
  it("is plain when everything went in", () => {
    renderWithProviders(<ListBasketResult listName="Weekly" result={{ added: ["A", "B"], skipped: [] }} onDismiss={() => {}} />);
    expect(screen.getByText("Added all 2 products from “Weekly” to your basket")).toBeInTheDocument();
  });
});

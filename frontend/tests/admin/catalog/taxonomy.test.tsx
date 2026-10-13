import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Taxonomy } from "@/components/admin/catalog/taxonomy";
import { apiError, mockApi, renderAdmin, UNITS } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/admin/taxonomy" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { window.history.replaceState(null, "", "/admin/taxonomy"); });

const cat = (id: number, name: string, parent: number | null, sort = 100, over: Record<string, unknown> = {}) => ({
  id, parent, name, slug: name.toLowerCase().replace(/\W+/g, "-"), description: "", image: {}, sort_order: sort, is_active: true, show_on_home: false, product_count: 0, active_product_count: 0, children_count: 0, ...over,
});

describe("Taxonomy — categories", () => {
  it("lists the tree and reorders siblings with explicit buttons, renumbering equal sort orders", async () => {
    const tree = [cat(1, "Bakery", null, 100, { children_count: 0 }), cat(2, "Dairy", null, 100, { children_count: 1 }), cat(3, "Eggs", 2, 100)];
    const api = mockApi({
      "GET /admin/categories/": { json: tree },
      "PATCH /admin/categories/1/": { json: tree[0] }, "PATCH /admin/categories/2/": { json: tree[1] },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Taxonomy />, ["catalog.read", "catalog.write"]);
    await screen.findByRole("button", { name: /Edit Bakery/ });
    expect(screen.getByRole("button", { name: /Edit Eggs/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Bakery up" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move Dairy up" }));
    await waitFor(() => expect(api.calls.filter((c) => c.key.startsWith("PATCH /admin/categories/")).length).toBe(2));
    const patches = Object.fromEntries(api.calls.filter((c) => c.key.startsWith("PATCH")).map((c) => [c.key, c.body]));
    expect(patches).toEqual({ "PATCH /admin/categories/2/": { sort_order: 10 }, "PATCH /admin/categories/1/": { sort_order: 20 } });
  });

  it("creates a sub-category under a department and shows the server's field error", async () => {
    const api = mockApi({
      "GET /admin/categories/": { json: [cat(2, "Dairy", null, 100, { children_count: 1 }), cat(3, "Eggs", 2)] },
      "POST /admin/categories/": apiError(400, "VALIDATION_ERROR", "Check the highlighted fields.", { slug: ["A category with this slug already exists."] }),
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Taxonomy />, ["catalog.read", "catalog.write"]);
    await screen.findByRole("button", { name: /Edit Dairy/ });
    await user.click(screen.getByRole("button", { name: /Sub-category in Dairy/ }));
    const dialog = await screen.findByRole("dialog", { name: "New category" });
    expect(within(dialog).getByRole("combobox", { name: "Department" })).toHaveValue("2");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Milk");
    await user.type(within(dialog).getByRole("textbox", { name: "Web address (slug)" }), "eggs");
    await user.click(within(dialog).getByRole("button", { name: "Create category" }));
    const slug = within(dialog).getByRole("textbox", { name: "Web address (slug)" });
    await waitFor(() => expect(slug).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(slug.getAttribute("aria-describedby")!)).toHaveTextContent("A category with this slug already exists.");
    expect(api.calls.find((c) => c.key === "POST /admin/categories/")!.body).toMatchObject({ name: "Milk", parent: 2, slug: "eggs", is_active: true });
  });

  it("is read-only for a role that can't write", async () => {
    mockApi({ "GET /admin/categories/": { json: [cat(2, "Dairy", null, 100, { product_count: 3 })] } });
    renderAdmin(<Taxonomy />, ["catalog.read", "catalog.merchandise"]);
    await screen.findByRole("button", { name: /View Dairy/ });
    expect(screen.queryByRole("button", { name: /New department/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move Dairy/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Your role can view the tree but not change it/)).toBeInTheDocument();
  });
});

describe("Taxonomy — collections and lookups", () => {
  it("manages collection membership with a search picker and up/down order, saved as one PUT", async () => {
    const collection = { id: 4, name: "Weekly picks", slug: "weekly-picks", description: "", is_active: true, show_on_home: false, sort_order: 100, starts_on: null, ends_on: null, is_current: true, product_count: 2 };
    const members = [{ id: 1, sku: "A", name: "Apples", slug: "apples", status: "ACTIVE", sort_order: 0 }, { id: 2, sku: "B", name: "Bananas", slug: "bananas", status: "ACTIVE", sort_order: 1 }];
    const api = mockApi({
      "GET /admin/collections/": { json: [collection] },
      "GET /admin/collections/4/products/": { json: members },
      "GET /admin/products/": { json: { count: 1, page: 1, page_size: 8, total_pages: 1, next: null, previous: null, results: [{ id: 3, sku: "C", name: "Cherries", status: "ACTIVE" }] } },
      "PUT /admin/collections/4/products/": ({ body }) => ({ json: body.product_ids.map((id: number, i: number) => ({ id, sku: "x", name: `P${id}`, slug: "x", status: "ACTIVE", sort_order: i })) }),
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Taxonomy />, ["catalog.read", "catalog.merchandise"]);
    await user.click(screen.getByRole("tab", { name: "Collections" }));
    await user.click(await screen.findByRole("button", { name: "Weekly picks" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Weekly picks" });
    await within(dialog).findByText("Apples");
    await user.click(within(dialog).getByRole("button", { name: "Move Bananas up" }));
    await user.type(within(dialog).getByRole("searchbox", { name: "Add a product" }), "cher");
    await user.click(await within(dialog).findByRole("button", { name: "Add Cherries" }));
    expect(within(dialog).getByText("Product changes not saved yet")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save products" }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "PUT /admin/collections/4/products/")?.body).toEqual({ product_ids: [2, 1, 3] }));
  });

  it("shows units and allergens as read-only reference data", async () => {
    mockApi({ "GET /admin/units/": { json: UNITS }, "GET /admin/allergens/": { json: [{ id: 1, code: "milk", name: "Milk" }] } });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Taxonomy />, ["catalog.read", "catalog.write"]);
    await user.click(screen.getByRole("tab", { name: "Units" }));
    expect(await screen.findByText("Kilogram")).toBeInTheDocument();
    expect(screen.getByText("Whole numbers only")).toBeInTheDocument();
    expect(screen.getByText(/can't be edited here/)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Allergens" }));
    expect(await screen.findByText("Milk")).toBeInTheDocument();
  });
});

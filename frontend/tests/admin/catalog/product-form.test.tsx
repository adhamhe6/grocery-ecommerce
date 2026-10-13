import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductEditor } from "@/components/admin/catalog/product-editor";
import { apiError, lookupRoutes, mockApi, renderAdmin } from "./helpers";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: push, prefetch: vi.fn() }), usePathname: () => "/admin/products/new", useSearchParams: () => new URLSearchParams() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); push.mockClear(); });
beforeEach(() => { window.history.replaceState(null, "", "/admin/products/new"); });

const detail = (over: Record<string, unknown> = {}) => ({
  id: 9, sku: "APL-1", slug: "gala-apples", name: "Gala apples", short_description: "", description: "", category: 2, category_name: "Apples", brand: null, brand_name: null, barcode: null,
  product_type: "LOOSE_PRODUCE", storage_type: "AMBIENT", sale_unit: 11, sale_unit_code: "kg", price: "2.50", unit_price: { amount: "2.50", per: "kg" }, tax_rate: "0.00",
  qty_min: "0.5", qty_step: "0.5", qty_max: null, net_content: null, net_content_unit: null, is_variable_weight: false, stock_mode: "TRACKED", tracks_batches: false, is_perishable: true, sell_buffer_days: 1,
  status: "ACTIVE", is_available: true, is_featured: false, origin_country: "", origin_note: "", storage_instructions: "", ingredients: "", packaging: "", manufacturer: "", allergen_info_complete: false,
  popularity: 0, rating_avg: null, rating_count: 0, is_demo: false, missing: ["image", "description"], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
  images: [], claims: [], allergens: [], nutrition: null, ...over,
});

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "Name" }), "Gala apples");
  await user.type(screen.getByRole("textbox", { name: "SKU" }), "APL-1");
  await user.selectOptions(screen.getByRole("combobox", { name: "Category" }), "2");
  await user.selectOptions(screen.getByRole("combobox", { name: "Sale unit" }), "11");
  await user.type(screen.getByRole("textbox", { name: "Price" }), "2.50");
}

describe("ProductEditor — server errors land on the fields they belong to", () => {
  it("blocks an empty form with required-field messages before calling the API", async () => {
    const api = mockApi(lookupRoutes());
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductEditor />);
    await screen.findByRole("option", { name: "Apples" });
    await user.type(screen.getByRole("textbox", { name: "Name" }), "x"); // make the form dirty so Save is enabled
    await user.click(screen.getByRole("button", { name: "Create product" }));
    expect(await screen.findAllByText("Enter a SKU.")).not.toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "SKU" })).toHaveAttribute("aria-invalid", "true");
    expect(api.calls.some((c) => c.key === "POST /admin/products/")).toBe(false);
  });

  it("maps a 400 to the SKU and maximum-quantity fields, associates the messages and focuses the first one", async () => {
    const api = mockApi({
      ...lookupRoutes(),
      "POST /admin/products/": apiError(400, "VALIDATION_ERROR", "Check the highlighted fields.", { sku: ["A product with this SKU already exists."], qty_max: ["The maximum can't be below the minimum quantity."] }),
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductEditor />);
    await screen.findByRole("option", { name: "Apples" });
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Create product" }));

    const sku = screen.getByRole("textbox", { name: "SKU" });
    await waitFor(() => expect(sku).toHaveAttribute("aria-invalid", "true"));
    const describedBy = sku.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveTextContent("A product with this SKU already exists.");
    const max = screen.getByRole("textbox", { name: "Maximum quantity" });
    expect(max).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(max.getAttribute("aria-describedby")!)).toHaveTextContent("The maximum can't be below the minimum quantity.");
    await waitFor(() => expect(sku).toHaveFocus());

    const summary = screen.getByText(/2 things need fixing/).closest("[role=alert]") as HTMLElement;
    expect(within(summary).getByRole("link", { name: "SKU" })).toBeInTheDocument();
    expect(within(summary).getByRole("link", { name: "Maximum quantity" })).toBeInTheDocument();
    // the request carried exactly what was typed, with blanks as null
    const sent = api.calls.find((c) => c.key === "POST /admin/products/")!.body;
    expect(sent).toMatchObject({ name: "Gala apples", sku: "APL-1", category: 2, sale_unit: 11, price: "2.50", barcode: null, brand: null, qty_max: null, status: "INACTIVE" });
    // the product wasn't created, so the page is still the "new" form
    expect(screen.getByRole("button", { name: "Create product" })).toBeInTheDocument();
  });

  it("clears a field's message as soon as the field is edited", async () => {
    mockApi({ ...lookupRoutes(), "POST /admin/products/": apiError(400, "VALIDATION_ERROR", "x", { sku: ["A product with this SKU already exists."] }) });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductEditor />);
    await screen.findByRole("option", { name: "Apples" });
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Create product" }));
    const sku = screen.getByRole("textbox", { name: "SKU" });
    await waitFor(() => expect(sku).toHaveAttribute("aria-invalid", "true"));
    await user.type(sku, "2");
    await waitFor(() => expect(sku).toHaveAttribute("aria-invalid", "false"));
  });

  it("maps a nutrition error on an existing product, saves nothing else, and keeps the form dirty", async () => {
    const api = mockApi({
      ...lookupRoutes(),
      "GET /admin/products/9/": { json: detail() },
      "PUT /admin/products/9/nutrition/": apiError(400, "VALIDATION_ERROR", "Check the highlighted fields.", { saturates: ["Saturates can't exceed total fat."] }),
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductEditor productId={9} />);
    await screen.findByDisplayValue("Gala apples");
    await user.click(screen.getByRole("checkbox", { name: /This product has a nutrition panel/ }));
    await user.type(screen.getByRole("combobox", { name: /Values are/ }), "per 100 g");
    await user.type(screen.getByRole("textbox", { name: /Source/ }), "Supplier sheet");
    await user.type(screen.getByRole("textbox", { name: "Fat (g)" }), "1");
    await user.type(screen.getByRole("textbox", { name: "of which saturates (g)" }), "2");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const sat = screen.getByRole("textbox", { name: "of which saturates (g)" });
    await waitFor(() => expect(sat).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(sat.getAttribute("aria-describedby")!)).toHaveTextContent("Saturates can't exceed total fat.");
    expect(api.calls.some((c) => c.key === "PATCH /admin/products/9/")).toBe(false); // details were untouched
    expect(api.calls.find((c) => c.key === "PUT /admin/products/9/nutrition/")!.body).toMatchObject({ basis: "per 100 g", source: "Supplier sheet", fat: "1", saturates: "2", protein: null });
    expect(screen.getByText("You have unsaved changes")).toBeInTheDocument();
  });

  it("keeps a created product's other sections when one of them fails, and switches to edit mode", async () => {
    const created = detail({ missing: [] });
    const api = mockApi({
      ...lookupRoutes(),
      "POST /admin/products/": { status: 201, json: created },
      "GET /admin/products/9/": { json: created },
      "PUT /admin/products/9/claims/": apiError(400, "VALIDATION_ERROR", "Check the highlighted fields.", [{ evidence: ["Evidence (certificate number, label review, supplier statement…) is required to mark a claim as verified."] }]),
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductEditor />);
    await screen.findByRole("option", { name: "Apples" });
    await fillRequired(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "Organic" }), "claimed");
    await user.click(screen.getByRole("button", { name: "Create product" }));

    // The product exists now: the claim error is shown on the claim's own evidence field.
    const evidence = await screen.findByRole("textbox", { name: /Evidence for organic/ });
    await waitFor(() => expect(evidence).toHaveAttribute("aria-invalid", "true"));
    expect(api.calls.some((c) => c.key === "POST /admin/products/")).toBe(true);
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument(); // edit mode now
    expect(window.location.pathname).toBe("/admin/products/9");
    expect(screen.getByText(/Saved: details\. Not saved: claims\./)).toBeInTheDocument();
  });
});

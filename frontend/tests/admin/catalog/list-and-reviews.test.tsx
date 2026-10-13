import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductList } from "@/components/admin/catalog/product-list";
import { Reviews } from "@/components/admin/catalog/reviews";
import { CATEGORIES, mockApi, renderAdmin } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/admin/products" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const row = (over: Record<string, unknown>) => ({
  id: 1, sku: "APL-1", slug: "gala", name: "Gala apples", category: 2, category_name: "Apples", brand: null, brand_name: null, sale_unit_code: "kg", price: "2.50", status: "ACTIVE", is_available: true, is_featured: false,
  is_demo: false, missing: [], updated_at: "2026-10-01T00:00:00Z", ...over,
});
const page = (rows: unknown[]) => ({ count: rows.length, page: 1, page_size: 25, total_pages: 1, next: null, previous: null, results: rows });

describe("ProductList", () => {
  it("shows price, status, gaps, and switches availability with the narrow endpoint", async () => {
    const api = mockApi({
      "GET /admin/products/": { json: page([row({}), row({ id: 2, sku: "PER-1", name: "Conference pears", price: "3.10", missing: ["image", "allergens"], is_available: false, status: "INACTIVE" })]) },
      "GET /admin/categories/": { json: CATEGORIES }, "GET /admin/brands/": { json: [] },
      "PATCH /admin/products/1/availability/": { json: row({ is_available: false }) },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductList />, ["catalog.read", "catalog.availability"]);
    await screen.findByText("Gala apples");
    const table = screen.getByRole("table", { name: "Products" });
    expect(within(table).getByText("$2.50")).toBeInTheDocument();
    expect(within(table).getByText("Complete")).toBeInTheDocument();
    expect(within(table).getByText("2 gaps")).toBeInTheDocument();
    expect(within(table).getByText("Photo, Allergens not confirmed")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /New product/ })).not.toBeInTheDocument(); // no catalog.write

    await user.click(screen.getByRole("switch", { name: "Gala apples available to order" }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "PATCH /admin/products/1/availability/")?.body).toEqual({ is_available: false }));
    expect(screen.getByRole("switch", { name: "Conference pears available to order" })).toHaveAttribute("aria-checked", "false");
  });

  it("sends the needs-attention filter to the API and offers to clear it", async () => {
    const urls: string[] = [];
    mockApi({
      "GET /admin/products/": ({ url }) => { urls.push(url.search); return { json: page([]) }; },
      "GET /admin/categories/": { json: CATEGORIES }, "GET /admin/brands/": { json: [] },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<ProductList />, ["catalog.read", "catalog.write"]);
    await screen.findByText("No products yet");
    expect(urls[0]).toContain("status=ACTIVE%2CINACTIVE");
    await user.selectOptions(screen.getByRole("combobox", { name: "Needs attention" }), "image");
    await screen.findByText("No products match these filters");
    expect(urls.at(-1)).toContain("missing=image");
    await user.selectOptions(screen.getByRole("combobox", { name: "Needs attention" }), "any");
    await waitFor(() => expect(urls.at(-1)).toContain("incomplete=true"));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByText("No products yet");
  });

  it("shows the server's error when the list fails, with a retry", async () => {
    mockApi({ "GET /admin/products/": { status: 500, json: { error: { code: "SERVER_ERROR", message: "The catalogue is unavailable.", details: {} } } }, "GET /admin/categories/": { json: [] }, "GET /admin/brands/": { json: [] } });
    renderAdmin(<ProductList />);
    expect(await screen.findByText("The catalogue is unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});

const review = (over: Record<string, unknown>) => ({
  id: 5, product: { id: 1, sku: "APL-1", name: "Gala apples" }, author: "Reviewer 1", rating: 4, title: "Crisp", body: "Lovely and crisp.", status: "PENDING", verified_purchase: true, is_demo: false,
  created_at: "2026-10-10T10:00:00Z", updated_at: "2026-10-10T10:00:00Z", ...over,
});

describe("Reviews", () => {
  it("shows verified-purchase and demo flags, approves in one click and rejects with a note", async () => {
    const api = mockApi({
      "GET /admin/reviews/": ({ url }) => ({ json: page(url.searchParams.get("page_size") === "1" ? [review({})] : [review({}), review({ id: 6, author: "Reviewer 2", verified_purchase: false, is_demo: true, body: "", title: "" })]) }),
      "POST /admin/reviews/5/approve/": { json: review({ status: "APPROVED" }) },
      "POST /admin/reviews/6/reject/": { json: review({ id: 6, status: "REJECTED" }) },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Reviews />, ["content.manage", "catalog.merchandise"]);
    expect(await screen.findByText("Verified purchase")).toBeInTheDocument();
    expect(screen.getByText("Not a verified purchase")).toBeInTheDocument();
    expect(screen.getByText("Demo review")).toBeInTheDocument();
    expect(screen.getByText("No written comment — rating only.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Approve review by Reviewer 1/ }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /admin/reviews/5/approve/")).toBe(true));

    await user.click(screen.getByRole("button", { name: /Reject review by Reviewer 2/ }));
    const dialog = await screen.findByRole("dialog", { name: "Reject this review?" });
    await user.type(within(dialog).getByRole("textbox", { name: /Reason/ }), "spam");
    await user.click(within(dialog).getByRole("button", { name: "Reject review" }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "POST /admin/reviews/6/reject/")?.body).toEqual({ note: "spam" }));
  });

  it("explains instead of failing when the role lacks the content permission", async () => {
    mockApi({});
    renderAdmin(<Reviews />, ["catalog.merchandise"]);
    expect(await screen.findByText("Moderating reviews needs the content permission")).toBeInTheDocument();
  });
});

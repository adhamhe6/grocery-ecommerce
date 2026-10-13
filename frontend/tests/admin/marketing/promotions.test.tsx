import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Promotions } from "@/components/admin/marketing/promotions";
import { apiError, CATEGORIES, mockApi, renderAdmin } from "../catalog/helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => "/admin/promotions" }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { window.history.replaceState(null, "", "/admin/promotions"); });

const page = (rows: unknown[]) => ({ count: rows.length, page: 1, page_size: 20, total_pages: 1, next: null, previous: null, results: rows });
const promo = (over: Record<string, unknown> = {}) => ({
  id: 7, name: "Apple week", label: "20% off", kind: "PERCENT_OFF", scope: "CATEGORIES", products: [], categories: [2], brands: [], percent: "20.00", amount_off: null, multibuy_qty: null, multibuy_price: null,
  starts_at: "2026-11-01T05:00:00Z", ends_at: "2026-11-30T05:00:00Z", is_active: true, is_running: false, is_demo: false, warnings: [], created_at: "x", updated_at: "x", ...over,
});
const base = () => ({ "GET /admin/categories/": { json: CATEGORIES }, "GET /admin/brands/": { json: [{ id: 3, name: "Green Valley", slug: "gv", description: "", is_active: true, is_demo: false, product_count: 0 }] }, "GET /admin/coupons/": { json: page([]) } });

describe("Promotions", () => {
  it("lists promotions with a plain-language offer and state", async () => {
    mockApi({ ...base(), "GET /admin/promotions/": { json: page([promo()]) } });
    renderAdmin(<Promotions />, ["promotions.manage"]);
    expect(await screen.findByText("20% off Apples, Nov 1 – 30, 2026")).toBeInTheDocument(); // the store's locale (en-US) and time zone
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
  });

  it("shows only the fields the chosen kind needs, previews the offer, and sends a kind-specific body", async () => {
    const api = mockApi({
      ...base(),
      "GET /admin/promotions/": { json: page([]) },
      "POST /admin/promotions/": { status: 201, json: promo({ id: 8, name: "Fruit sale", label: "3 for $5.00", kind: "MULTIBUY", percent: null, multibuy_qty: 3, multibuy_price: "5.00", warnings: ["3 for $5.00 is not cheaper than buying them at the shelf price for 1 of 1 product(s): Apples ($1.00)."] }) },
      "GET /admin/promotions/8/": { json: promo({ id: 8, kind: "MULTIBUY", percent: null, multibuy_qty: 3, multibuy_price: "5.00", warnings: [] }) },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Promotions />, ["promotions.manage"]);
    await user.click(await screen.findByRole("button", { name: /New promotion/ }));
    const dialog = await screen.findByRole("dialog", { name: "New promotion" });
    const d = within(dialog);
    expect(d.getByRole("textbox", { name: /Percentage off/ })).toBeInTheDocument();
    expect(d.queryByRole("textbox", { name: /Amount off each unit/ })).not.toBeInTheDocument();

    await user.click(d.getByRole("radio", { name: /Multibuy/ }));
    expect(d.queryByRole("textbox", { name: /Percentage off/ })).not.toBeInTheDocument();
    await user.type(d.getByRole("textbox", { name: /Number of items/ }), "3");
    await user.type(d.getByRole("textbox", { name: /Price for the group/ }), "5");
    await user.click(d.getByRole("radio", { name: /Categories/ }));
    await user.click(d.getByRole("checkbox", { name: "Apples" }));
    expect(d.getByText(/^3 for \$5\.00 on Apples, from when it is saved, no end date$/)).toBeInTheDocument();

    await user.type(d.getByRole("textbox", { name: "Name" }), "Fruit sale");
    await user.click(d.getByRole("button", { name: /Use “3 for \$5\.00”/ }));
    await user.click(d.getByRole("button", { name: "Create promotion" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /admin/promotions/")).toBe(true));
    expect(api.calls.find((c) => c.key === "POST /admin/promotions/")!.body).toEqual({
      name: "Fruit sale", label: "3 for $5.00", kind: "MULTIBUY", scope: "CATEGORIES", is_active: true, percent: null, amount_off: null, multibuy_qty: 3, multibuy_price: "5",
      products: [], categories: [2], brands: [], ends_at: null,
    });
    // the engine's warning about an offer that doesn't save money is surfaced
    expect(await d.findByText(/is not cheaper than buying them at the shelf price/)).toBeInTheDocument();
  });

  it("blocks an empty form with messages tied to the fields, and shows API errors on the right field", async () => {
    const api = mockApi({
      ...base(), "GET /admin/promotions/": { json: page([]) },
      "POST /admin/promotions/": apiError(400, "VALIDATION_ERROR", "Check the highlighted fields.", { ends_at: ["The end must be after the start."] }),
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Promotions />, ["promotions.manage"]);
    await user.click(await screen.findByRole("button", { name: /New promotion/ }));
    const d = within(await screen.findByRole("dialog", { name: "New promotion" }));
    await user.type(d.getByRole("textbox", { name: "Name" }), "x");
    await user.click(d.getByRole("button", { name: "Create promotion" }));
    const label = d.getByRole("textbox", { name: /Badge text/ });
    await waitFor(() => expect(label).toHaveAttribute("aria-invalid", "true"));
    expect(d.getByRole("textbox", { name: /Percentage off/ })).toHaveAttribute("aria-invalid", "true");
    expect(api.calls.some((c) => c.key === "POST /admin/promotions/")).toBe(false);

    await user.type(label, "20% off");
    await user.type(d.getByRole("textbox", { name: /Percentage off/ }), "20");
    await user.click(d.getByRole("radio", { name: /Categories/ }));
    await user.click(d.getByRole("checkbox", { name: "Apples" }));
    await user.click(d.getByRole("button", { name: "Create promotion" }));
    const ends = await d.findByLabelText("Ends");
    await waitFor(() => expect(ends).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById(ends.getAttribute("aria-describedby")!)).toHaveTextContent("The end must be after the start.");
  });

  it("explains that promotions don't stack instead of inventing a priority control", async () => {
    mockApi({ ...base(), "GET /admin/promotions/": { json: page([]) } });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Promotions />, ["promotions.manage"]);
    await user.click(await screen.findByRole("button", { name: /New promotion/ }));
    const d = within(await screen.findByRole("dialog", { name: "New promotion" }));
    expect(d.getByText(/Promotions never stack on one product/)).toBeInTheDocument();
    expect(d.queryByLabelText(/priority/i)).not.toBeInTheDocument();
  });
});

const coupon = (over: Record<string, unknown> = {}) => ({
  id: 3, code: "WELCOME10", description: "", kind: "PERCENT", value: "10.00", max_discount: "5.00", min_order_value: "30.00", starts_at: "2026-10-01T00:00:00Z", ends_at: null, usage_limit: 100, per_customer_limit: 1,
  first_order_only: true, scope: "ALL", categories: [], products: [], excluded_products: [], exclude_discounted_items: true, used_count: 12, is_redeemed: true, is_active: true, is_demo: false, created_at: "x", updated_at: "x", ...over,
});

describe("Coupons", () => {
  it("lists usage, opens the editor with the redemption stats, and locks the code once redeemed", async () => {
    mockApi({
      ...base(), "GET /admin/promotions/": { json: page([]) }, "GET /admin/coupons/": { json: page([coupon()]) },
      "GET /admin/coupons/3/stats/": { json: { code: "WELCOME10", used_count: 12, usage_limit: 100, redemptions: { active: 11, void: 1 }, total_discount: "41.50", voided_discount: "4.00", last_redemptions: [{ order_number: "OR-1", email: "a***@example.com", amount: "5.00", status: "ACTIVE", created_at: "2026-10-05T10:00:00Z" }] } },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Promotions />, ["promotions.manage"]);
    await user.click(await screen.findByRole("tab", { name: "Coupons" }));
    expect(await screen.findByText("10% off (up to $5.00)")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "WELCOME10" }));
    const d = within(await screen.findByRole("dialog", { name: "Edit WELCOME10" }));
    expect(await d.findByText("a***@example.com")).toBeInTheDocument();
    expect(d.getByText("$41.50")).toBeInTheDocument();
    expect(d.getByRole("textbox", { name: /^Code/ })).toBeDisabled();
    expect(d.getByText(/10% off \(up to \$5\.00\) on the whole basket, orders of \$30\.00 or more, first order only, once per customer/)).toBeInTheDocument();
  });

  it("hides value and targets for free delivery and sends a whole-basket zero-value body", async () => {
    const api = mockApi({
      ...base(), "GET /admin/promotions/": { json: page([]) },
      "POST /admin/coupons/": { status: 201, json: coupon({ id: 4, code: "SHIPFREE", kind: "FREE_DELIVERY", value: "0.00", max_discount: null, used_count: 0, is_redeemed: false }) },
      "GET /admin/coupons/4/stats/": { json: { code: "SHIPFREE", used_count: 0, usage_limit: null, redemptions: { active: 0, void: 0 }, total_discount: "0.00", voided_discount: "0.00", last_redemptions: [] } },
    });
    const user = userEvent.setup({ delay: null });
    renderAdmin(<Promotions />, ["promotions.manage"]);
    await user.click(await screen.findByRole("tab", { name: "Coupons" }));
    await user.click(await screen.findByRole("button", { name: /New coupon/ }));
    const d = within(await screen.findByRole("dialog", { name: "New coupon" }));
    await user.type(d.getByRole("textbox", { name: /^Code/ }), "shipfree");
    await user.click(d.getByRole("radio", { name: /Free delivery/ }));
    expect(d.queryByRole("textbox", { name: /Percentage off|Amount off/ })).not.toBeInTheDocument();
    expect(d.getByText("Free-delivery coupons apply to the whole order.")).toBeInTheDocument();
    await user.click(d.getByRole("button", { name: "Create coupon" }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "POST /admin/coupons/")).toBeTruthy());
    expect(api.calls.find((c) => c.key === "POST /admin/coupons/")!.body).toMatchObject({ code: "SHIPFREE", kind: "FREE_DELIVERY", value: "0", scope: "ALL", max_discount: null, per_customer_limit: 1, usage_limit: null });
  });
});

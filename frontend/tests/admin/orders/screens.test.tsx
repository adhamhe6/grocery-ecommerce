import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseDetailPage } from "@/components/admin/orders/case-detail";
import { CustomerDetailPage } from "@/components/admin/orders/customer-detail";
import { OrdersListPage } from "@/components/admin/orders/orders-list";
import { PickingQueuePage } from "@/components/admin/orders/picking-queue";
import type { CustomerDetail, OrderRow, QueueResponse, SupportCase } from "@/components/admin/orders/types";
import { mockApi, MANAGER_CAPS, renderAdmin } from "./helpers";

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/admin/orders",
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => { search = ""; replace.mockClear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const row = (over: Partial<OrderRow> = {}): OrderRow => ({
  number: "OR-1", status: "CONFIRMED", status_label: "Confirmed", payment_status: "PENDING_COLLECTION", payment_method: "COD", fulfilment_type: "DELIVERY", placed_at: "2026-10-12T09:00:00Z",
  slot_starts_at: "2026-10-12T14:00:00Z", slot_ends_at: "2026-10-12T16:00:00Z", customer: "Sam Shopper", is_guest: false, branch: "Main store", branch_id: 1, total: "14.00", final_total: null,
  item_count: 2, assigned_to: null, awaiting_customer: false, is_late: false, substitution_policy: "ALLOW", ...over,
});
const page = (results: unknown[]) => ({ count: results.length, page: 1, page_size: 24, total_pages: 1, next: null, previous: null, results });

describe("Orders list", () => {
  it("turns the dashboard's ?open=1 link into the list of open statuses", async () => {
    search = "open=1";
    let requested = "";
    mockApi({ "GET /admin/orders/": ({ url }) => { requested = url; return { json: page([row()]) }; } });
    renderAdmin(<OrdersListPage />);
    expect(await screen.findByRole("link", { name: "OR-1" })).toBeInTheDocument();
    const params = new URL(requested).searchParams;
    expect(params.get("status")).toBe("CONFIRMED,PICKING,PACKING,READY_FOR_PICKUP,READY_FOR_DISPATCH,OUT_FOR_DELIVERY");
    expect(params.get("ordering")).toBe("-placed_at");
    expect(screen.getByLabelText("Status")).toHaveValue("open");
  });

  it("passes every filter to the API and shows status, payment and totals", async () => {
    search = "status=PICKING&type=PICKUP&payment=PAID&from=2026-10-01&to=2026-10-12&slot=2026-10-12&attention=1&mine=1&search=sam&ordering=total";
    let requested = "";
    mockApi({ "GET /admin/orders/": ({ url }) => { requested = url; return { json: page([row({ status: "PICKING", status_label: "Being picked", payment_status: "PAID", payment_method: "CARD", final_total: "13.10", is_late: true, awaiting_customer: true })]) }; } });
    renderAdmin(<OrdersListPage />);
    await screen.findByRole("link", { name: "OR-1" });
    const p = new URL(requested).searchParams;
    expect(Object.fromEntries(p)).toMatchObject({ status: "PICKING", fulfilment_type: "PICKUP", payment_status: "PAID", placed_from: "2026-10-01", placed_to: "2026-10-12", slot_date: "2026-10-12", needs_attention: "true", mine: "true", search: "sam", ordering: "total" });
    const tr = screen.getByRole("link", { name: "OR-1" }).closest("tr") as HTMLElement;
    expect(within(tr).getByText("Being picked")).toBeInTheDocument();
    expect(within(tr).getByText("Paid")).toBeInTheDocument();
    expect(within(tr).getByText("$13.10")).toBeInTheDocument();
    expect(within(tr).getByText("Late")).toBeInTheDocument();
    expect(within(tr).getByText("Awaiting customer")).toBeInTheDocument();
  });

  it("changing a filter updates the URL and starts again from page one", async () => {
    search = "page=3";
    mockApi({ "GET /admin/orders/": { json: page([row()]) } });
    renderAdmin(<OrdersListPage />);
    await screen.findByRole("link", { name: "OR-1" });
    await userEvent.setup().selectOptions(screen.getByLabelText("Type"), "PICKUP");
    expect(replace).toHaveBeenCalledWith("/admin/orders?type=PICKUP", { scroll: false });
  });

  it("explains an empty result honestly", async () => {
    search = "status=CANCELLED";
    mockApi({ "GET /admin/orders/": { json: page([]) } });
    renderAdmin(<OrdersListPage />);
    expect(await screen.findByText("No orders match these filters")).toBeInTheDocument();
  });

  it("shows the API's error with a retry", async () => {
    mockApi({ "GET /admin/orders/": { status: 500, json: { error: { code: "SERVER_ERROR", message: "Database is down", details: {} } } } });
    renderAdmin(<OrdersListPage />);
    expect(await screen.findByText("Database is down", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("is hidden from roles without orders.read", () => {
    renderAdmin(<OrdersListPage />, ["customers.read"]);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });
});

describe("Picking queue", () => {
  const queue = (rows: object[]): QueueResponse => ({
    counts: { CONFIRMED: 1, PICKING: 1 },
    groups: [{ slot_starts_at: "2026-10-12T14:00:00Z", slot_ends_at: "2026-10-12T16:00:00Z", orders: rows as never }],
  });

  it("groups by slot, shows who is picking, progress and the right call to action per state", async () => {
    const api = mockApi({
      "GET /admin/orders/queue/": { json: queue([
        { ...row({ number: "OR-1", substitution_policy: "CONTACT" }), lines: 4, lines_done: 0 },
        { ...row({ number: "OR-2", status: "PICKING", status_label: "Being picked", assigned_to: "Pat Picker" }), lines: 4, lines_done: 3 },
      ]) },
    });
    renderAdmin(<PickingQueuePage />);
    expect(await screen.findByRole("button", { name: "Start picking" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue picking" })).toHaveAttribute("href", "/admin/picking/OR-2");
    expect(screen.getByText("Contact me first")).toBeInTheDocument();
    expect(screen.getByText("Pat Picker")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Lines picked on OR-2" })).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByText("3 of 4 lines")).toBeInTheDocument();
    expect(api.calls[0].key).toBe("GET /admin/orders/queue/");
  });

  it("filters by stage without another request", async () => {
    const api = mockApi({
      "GET /admin/orders/queue/": { json: queue([{ ...row({ number: "OR-1" }), lines: 4, lines_done: 0 }, { ...row({ number: "OR-2", status: "PICKING" }), lines: 4, lines_done: 3 }]) },
    });
    renderAdmin(<PickingQueuePage />);
    await screen.findByText("OR-2");
    search = "stage=picking";
    cleanup();
    renderAdmin(<PickingQueuePage />);
    await screen.findByText("OR-2");
    expect(screen.queryByText("OR-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /picking/i, pressed: true })).toBeInTheDocument();
    expect(api.calls.every((c) => c.key === "GET /admin/orders/queue/")).toBe(true);
  });

  it("is only for people who can fulfil orders", () => {
    renderAdmin(<PickingQueuePage />, ["orders.read"]);
    expect(screen.getByText("You don't have access to this page")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------------------------------------ support cases
const supportCase = (over: Partial<SupportCase> = {}): SupportCase => ({
  id: 5, order_number: "OR-1", order_status: "COMPLETED", payment_method: "CARD", branch: { id: 1, name: "Main store" }, customer: { id: 3, name: "Sam Shopper" }, order_item: { id: 1, name: "Whole milk" },
  kind: "DAMAGED", kind_label: "Damaged / poor quality", description: "The bottle leaked in the bag.", status: "OPEN", resolution: "NONE", refund_amount: "0.00", refund_status: null, refunds: [], refundable: "20.00",
  staff_notes: "", handled_by: null, created_at: "2026-10-12T09:00:00Z", updated_at: "2026-10-12T09:00:00Z", resolved_at: null, ...over,
});

describe("Case detail", () => {
  it("requires an amount for refunds, then resolves with exact decimals and reports the real refund state", async () => {
    const api = mockApi({
      "GET /admin/cases/5/": { json: supportCase() },
      "POST /admin/cases/5/resolve/": { json: { ...supportCase({ status: "RESOLVED", resolution: "REFUND", refund_amount: "5.00" }), refund: { id: 2, amount: "5.00", status: "PENDING", method: "MANUAL", completed: false, message: "Refund recorded but NOT yet paid out." } } },
    });
    renderAdmin(<CaseDetailPage id="5" />);
    const user = userEvent.setup();
    expect(await screen.findByText("The bottle leaked in the bag.")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /^Refund/ }));
    await user.click(screen.getByRole("button", { name: "Resolve case" }));
    expect(await screen.findByText("Enter the amount to refund.")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/refund amount/i), "25");
    await user.click(screen.getByRole("button", { name: "Resolve case" }));
    expect(await screen.findByText(/at most \$20\.00 can still be refunded/i)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/refund amount/i));
    await user.type(screen.getByLabelText(/refund amount/i), "5");
    await user.type(screen.getByLabelText(/^notes/i), "Replaced the bag");
    await user.click(screen.getByRole("button", { name: "Resolve case" }));
    expect(await screen.findByRole("heading", { name: /resolve and refund \$5\.00/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Resolve and refund" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /admin/cases/5/resolve/")).toBe(true));
    expect(api.calls.find((c) => c.key === "POST /admin/cases/5/resolve/")!.body).toEqual({ resolution: "REFUND", refund_amount: "5.00", staff_notes: "Replaced the bag" });
    expect(await screen.findByText(/is pending, not paid out/i)).toBeInTheDocument();
    expect(screen.getByText("Refund recorded but NOT yet paid out.")).toBeInTheDocument();
  });

  it("disables refunds when nothing was collected, and makes rejection need a reason", async () => {
    const api = mockApi({ "GET /admin/cases/5/": { json: supportCase({ refundable: null }) }, "POST /admin/cases/5/reject/": { json: supportCase({ status: "REJECTED" }) } });
    renderAdmin(<CaseDetailPage id="5" />);
    const user = userEvent.setup();
    await screen.findByText("The bottle leaked in the bag.");
    expect(screen.getByRole("radio", { name: /^Refund/ })).toBeDisabled();
    expect(screen.getByText("No money to return")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reject case" }));
    expect(await screen.findByText(/explain why the case is rejected/i)).toBeInTheDocument();
    expect(api.calls.some((c) => c.key.startsWith("POST"))).toBe(false);
    await user.type(screen.getByLabelText(/^notes/i), "Photo shows no damage");
    await user.click(screen.getByRole("button", { name: "Reject case" }));
    await screen.findByRole("heading", { name: "Reject this case?" });
    await user.click(screen.getAllByRole("button", { name: "Reject case" }).at(-1)!);
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /admin/cases/5/reject/")).toBe(true));
    expect(api.calls.find((c) => c.key === "POST /admin/cases/5/reject/")!.body).toEqual({ staff_notes: "Photo shows no damage" });
  });

  it("shows a closed case as a read-only outcome", async () => {
    mockApi({ "GET /admin/cases/5/": { json: supportCase({ status: "RESOLVED", resolution: "GOODWILL", refund_amount: "3.00", refund_status: "SUCCEEDED", staff_notes: "Sorry!", handled_by: "ann@staff.example.com", resolved_at: "2026-10-12T10:00:00Z" }) } });
    renderAdmin(<CaseDetailPage id="5" />);
    expect(await screen.findByText("Goodwill refund")).toBeInTheDocument();
    expect(screen.getByText("$3.00 (paid)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resolve case" })).not.toBeInTheDocument();
  });
});

// ------------------------------------------------------------------------------------------------ customers
const customer = (over: Partial<CustomerDetail> = {}): CustomerDetail => ({
  id: 3, email: "sam@example.com", full_name: "Sam Shopper", phone: "+1 555 0101", is_active: true, marketing_opt_in: true, joined_at: "2026-01-02T09:00:00Z", orders_count: 2, last_order_at: "2026-10-01T09:00:00Z",
  lifetime_spend: "30.50", notify_order_emails: true, addresses: [], orders: [{ number: "OR-1", status: "COMPLETED", total: "22.00", final_total: "20.00", placed_at: "2026-09-30T09:00:00Z", branch: "Main store", fulfilment_type: "DELIVERY" }], cases: [], ...over,
});

describe("Customer detail", () => {
  it("shows marketing status, spend and order history linking to orders", async () => {
    mockApi({ "GET /admin/customers/3/": { json: customer() } });
    renderAdmin(<CustomerDetailPage id="3" />, ["customers.read"]);
    expect(await screen.findByRole("heading", { name: "Sam Shopper" })).toBeInTheDocument();
    expect(screen.getAllByText("Subscribed").length).toBeGreaterThan(0);
    expect(screen.getByText("$30.50")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OR-1" })).toHaveAttribute("href", "/admin/orders/OR-1");
    expect(screen.getByText("$20.00")).toBeInTheDocument(); // final total, not the estimate
    expect(screen.queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument(); // read-only role
  });

  it("deactivates only after confirmation, sending just is_active", async () => {
    const api = mockApi({ "GET /admin/customers/3/": { json: customer() }, "PATCH /admin/customers/3/": { json: customer({ is_active: false }) } });
    renderAdmin(<CustomerDetailPage id="3" />, [...MANAGER_CAPS, "customers.manage"]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Deactivate account" }));
    expect(api.calls.some((c) => c.key.startsWith("PATCH"))).toBe(false);
    await user.click(screen.getAllByRole("button", { name: "Deactivate account" }).at(-1)!);
    await waitFor(() => expect(api.calls.some((c) => c.key === "PATCH /admin/customers/3/")).toBe(true));
    expect(api.calls.find((c) => c.key.startsWith("PATCH"))!.body).toEqual({ is_active: false });
  });
});

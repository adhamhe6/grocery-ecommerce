import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditPage } from "@/components/admin/audit/audit-page";
import { PaymentsPage } from "@/components/admin/finance/payments-page";
import { ReportPage } from "@/components/admin/reports/report-page";
import { ReportsIndex } from "@/components/admin/reports/reports-index";
import { StaffPage } from "@/components/admin/staff/staff-page";
import { mockApi, perms, renderAdmin } from "./helpers";

let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/payments",
}));
afterEach(() => { vi.unstubAllGlobals(); search = ""; });

const page = (results: unknown[]) => ({ count: results.length, page: 1, page_size: 24, total_pages: 1, next: null, previous: null, results });
const payment = (over = {}) => ({
  id: 7, order: "ORD-1001", branch: "Central", provider: "demo", method: "CARD", state: "FAILED", state_label: "Failed", amount: "25.00", captured: "0.00", refunded: "0.00",
  currency: "USD", reference: "demo_pi_x", attempt: 2, failure_code: "card_declined", failure_message: "Payment was declined.", created_at: "2026-10-12T09:00:00Z", captured_at: null, is_demo: true, ...over,
});

describe("Payments page", () => {
  it("honours ?state=FAILED from the dashboard link, flags demo payments and opens a detail drawer with the event timeline", async () => {
    search = "state=FAILED";
    const api = mockApi({
      "GET /admin/payments/": { json: page([payment()]) },
      "GET /admin/payments/7/": { json: { ...payment(), events: [{ at: "2026-10-12T09:01:00Z", type: "payment.failed", event_id: "evt_1", outcome: "APPLIED", error: "" }], refunds: [] } },
    });
    const user = userEvent.setup();
    renderAdmin(<PaymentsPage />);
    const row = (await screen.findByRole("link", { name: "ORD-1001" })).closest("tr")!;
    expect(api.of("GET /admin/payments/")[0].url).toContain("state=FAILED");
    expect(within(row).getByText(/payment: simulated, no money moves/i)).toBeInTheDocument(); // DEMO badge
    expect(within(row).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByLabelText("State", { selector: "select" })).toHaveValue("FAILED");
    await user.click(within(row).getByRole("button", { name: /open payment details for order ORD-1001/i }));
    expect(await screen.findByText("payment.failed")).toBeInTheDocument();
    expect(screen.getByText("evt_1", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Payment was declined.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refund…/i })).toBeDisabled(); // failed payments can't be refunded, and it says why
    expect(screen.getByText(/only captured or collected payments can be refunded/i)).toBeInTheDocument();
  });

  it("hides refund controls from roles without orders.refund", async () => {
    mockApi({
      "GET /admin/payments/": { json: page([payment({ state: "CAPTURED", state_label: "Captured", captured: "25.00" })]) },
      "GET /admin/payments/7/": { json: { ...payment({ state: "CAPTURED", state_label: "Captured", captured: "25.00" }), events: [], refunds: [] } },
    });
    const user = userEvent.setup();
    renderAdmin(<PaymentsPage />, perms({ capabilities: ["finance.read"] }));
    await user.click(await screen.findByRole("button", { name: /open payment details/i }));
    await screen.findByRole("heading", { name: "Provider events" });
    expect(screen.queryByRole("button", { name: /refund…/i })).not.toBeInTheDocument();
  });

  it("shows an honest empty state", async () => {
    mockApi({ "GET /admin/payments/": { json: page([]) } });
    renderAdmin(<PaymentsPage />);
    expect(await screen.findByText("No payments yet")).toBeInTheDocument();
  });
});

describe("Reports", () => {
  const sales = {
    key: "sales", title: "Sales by day", period: { from: "2026-09-13", to: "2026-10-12", days: 30 },
    columns: [{ key: "date", label: "Date", type: "date" }, { key: "orders", label: "Orders", type: "int" }, { key: "gross_sales", label: "Gross sales", type: "money" }, { key: "aov", label: "Avg order value", type: "money" }],
    rows: [{ date: "2026-10-10", orders: 2, gross_sales: "30.00", aov: "15.00" }, { date: "2026-10-11", orders: 1, gross_sales: "1234.50", aov: "1234.50" }],
    summary: { orders: 3, gross_sales: "1264.50", aov: "421.50", discounts: "0.00", net_sales: "1200.00" },
  };

  it("lists the reports the API offers", async () => {
    mockApi({ "GET /admin/reports/": { json: [{ key: "sales", title: "Sales by day" }, { key: "inventory-valuation", title: "Inventory valuation" }] } });
    renderAdmin(<ReportsIndex />, perms({ capabilities: ["reports.read"] }));
    expect(await screen.findByRole("link", { name: /sales by day/i })).toHaveAttribute("href", "/admin/reports/sales");
    expect(screen.getByText(/current stock — no date range/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Definitions" })).toBeInTheDocument();
  });

  it("builds the table from the column spec, formats by kind, charts sales, and offers CSV only with reports.export", async () => {
    const api = mockApi({ "GET /admin/reports/": { json: [{ key: "sales", title: "Sales by day" }] }, "GET /admin/reports/sales/": { json: sales } });
    const { unmount } = renderAdmin(<ReportPage name="sales" />, perms({ capabilities: ["reports.read", "reports.export"] }));
    const table = await screen.findByRole("table", { name: /sales by day: 2 rows/i });
    expect(within(table).getByText("Oct 10, 2026")).toBeInTheDocument();
    expect(within(table).getAllByText("$1,234.50", { selector: "td" })[0]).toHaveClass("text-right");
    expect(screen.getAllByText("$1,264.50").length).toBeGreaterThan(0); // headline gross sales from the summary
    expect(screen.getByRole("img", { name: /gross sales by day/i })).toBeInTheDocument();
    const csv = screen.getByRole("link", { name: /export csv/i });
    expect(csv).toHaveAttribute("download");
    expect(csv.getAttribute("href")).toMatch(/^\/api\/v1\/admin\/reports\/sales\/\?.*export=csv/);
    expect(screen.getByRole("heading", { name: "Definitions" })).toBeInTheDocument();
    expect(screen.getByText(/Σ amount due of accepted orders/)).toBeInTheDocument();
    expect(api.of("GET /admin/reports/sales/")[0].url).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    unmount();

    renderAdmin(<ReportPage name="sales" />, perms({ capabilities: ["reports.read"] }));
    await screen.findByRole("table", { name: /sales by day: 2 rows/i });
    expect(screen.queryByRole("link", { name: /export csv/i })).not.toBeInTheDocument();
  });

  it("scopes the report to the selected store via the branch parameter's absence for all stores", async () => {
    const api = mockApi({ "GET /admin/reports/": { json: [] }, "GET /admin/reports/sales/": { json: { ...sales, rows: [], summary: {} } } });
    renderAdmin(<ReportPage name="sales" />, perms({ capabilities: ["reports.read"] }));
    expect(await screen.findByText("Nothing to report for this period")).toBeInTheDocument();
    expect(api.of("GET /admin/reports/sales/")[0].url).not.toContain("branch=");
    expect(screen.getByText(/^store:/i).closest("p")).toHaveTextContent(/All stores/);
  });

  it("shows a clear message for an unknown report", async () => {
    mockApi({ "GET /admin/reports/": { json: [] }, "GET /admin/reports/nope/": { status: 404, json: { error: { code: "NOT_FOUND", message: "Unknown report.", details: {}, request_id: "r" } } } });
    renderAdmin(<ReportPage name="nope" />, perms({ capabilities: ["reports.read"] }));
    expect(await screen.findByText(/there is no report called “nope”/i)).toBeInTheDocument();
  });
});

describe("Staff page", () => {
  const me = { id: 1, email: "boss@example.com", full_name: "Boss Person", phone: "", role: "SUPER_ADMIN", role_label: "Super admin", is_active: true, all_branches: false, branches: [], has_password: true, last_login: "2026-10-11T08:00:00Z", created_at: "2026-01-01T00:00:00Z" };
  const clerk = { ...me, id: 2, email: "sam@example.com", full_name: "Sam Stone", role: "STORE_MANAGER", role_label: "Store manager", branches: [1], has_password: false, last_login: null };

  it("lists staff with stores, and protects your own account in the drawer", async () => {
    mockApi({ "GET /admin/staff/": { json: page([me, clerk]) }, "GET /admin/staff/1/": { json: me } });
    const user = userEvent.setup();
    renderAdmin(<StaffPage />);
    expect(await screen.findByText("Sam Stone")).toBeInTheDocument();
    expect(screen.getByText("Central")).toBeInTheDocument(); // store name from the branch list
    expect(screen.getByText("Invite pending")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Manage Boss Person" }));
    expect(await screen.findByText(/this is your own account/i)).toBeInTheDocument();
    const drawer = within(screen.getByRole("dialog"));
    expect(drawer.getByRole("button", { name: /deactivate account/i })).toBeDisabled();
    expect(drawer.getByLabelText(/^role/i)).toBeDisabled();
  });

  it("an admin sees admin accounts as read-only", async () => {
    const admin = { ...me, id: 3, role: "ADMIN", role_label: "Admin", email: "a@example.com", full_name: "Ada Admin" };
    mockApi({ "GET /admin/staff/": { json: page([admin]) }, "GET /admin/staff/3/": { json: admin } });
    const user = userEvent.setup();
    renderAdmin(<StaffPage />, perms({ id: 9, role: "ADMIN" }));
    await user.click(await screen.findByRole("button", { name: "Manage Ada Admin" }));
    expect(await screen.findByText(/only a super admin can change this account/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deactivate account/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
  });
});

describe("Audit page", () => {
  const entry = {
    id: 5, actor: 1, actor_email: "boss@example.com", action: "settings.updated", target_type: "StoreSettings", target_id: "1", summary: "",
    before: { name: "Orchard Row", tagline: "Fresh", note: "x".repeat(400) }, after: { name: "Fresh Co", tagline: "Fresh", note: "y".repeat(400) },
    ip_address: "203.0.113.9", request_id: "req-abc", created_at: "2026-10-12T09:00:00Z",
  };
  it("lists entries and shows a before/after diff with unchanged fields hidden and long values truncated", async () => {
    mockApi({ "GET /admin/audit/": { json: page([entry]) }, "GET /admin/audit/actions/": { json: ["settings.updated"] } });
    const user = userEvent.setup();
    renderAdmin(<AuditPage />, perms({ capabilities: ["audit.read"] }));
    expect(await screen.findByText("settings.updated")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.9")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /open details of settings.updated/i }));
    const diff = await screen.findByRole("table", { name: /field-by-field comparison/i });
    expect(within(diff).getByText("name")).toBeInTheDocument();
    expect(within(diff).getByText("Orchard Row")).toBeInTheDocument();
    expect(within(diff).getByText("Fresh Co")).toBeInTheDocument();
    expect(within(diff).queryByText("tagline")).not.toBeInTheDocument(); // unchanged → hidden by default
    expect(within(diff).getAllByText(/show all 400 characters/i)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /show 1 unchanged field/i }));
    await waitFor(() => expect(within(screen.getByRole("table", { name: /field-by-field/i })).getByText("tagline")).toBeInTheDocument());
  });
  it("sends the filters the API supports", async () => {
    search = "action=product.&from=2026-10-01";
    const api = mockApi({ "GET /admin/audit/": { json: page([]) }, "GET /admin/audit/actions/": { json: [] } });
    renderAdmin(<AuditPage />, perms({ capabilities: ["audit.read"] }));
    await screen.findByText("No entries match these filters");
    const url = api.of("GET /admin/audit/")[0].url;
    expect(url).toContain("action=product.");
    expect(url).toContain("date_from=2026-10-01");
  });
});

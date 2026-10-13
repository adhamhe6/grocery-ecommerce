import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewPurchaseOrder } from "@/components/admin/purchasing/po-form";
import { apiError, list, mockApi, purchaseOrder, renderAdmin } from "./helpers";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/admin/purchase-orders/new" }));
afterEach(() => { vi.unstubAllGlobals(); push.mockClear(); });

const supplier = { id: 3, code: "mill", name: "Millbrook Dairy", contact_name: "", email: "", phone: "", address: "", status: "ACTIVE", lead_time_days: 2, notes: "", product_count: 1, is_demo: false };
const rice = { id: 11, sku: "RICE", name: "Rice 1kg", tracks_batches: false, sale_unit_code: "ea", status: "ACTIVE" };
const routes = {
  "GET /admin/suppliers/": { json: list([supplier]) },
  "GET /admin/suppliers/3/products/": { json: [{ product_id: 11, sku: "RICE", name: "Rice 1kg", supplier_sku: "MB-RICE", unit_cost: "1.0500" }] },
  "GET /admin/products/": { json: list([rice]) },
};

async function pickRice(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Product \(line 1\)/), "ric");
  await user.click(await screen.findByRole("option", { name: /Rice 1kg/ }));
}

describe("NewPurchaseOrder", () => {
  it("fills the unit cost from the supplier's catalogue and totals lines from decimal strings", async () => {
    mockApi(routes);
    const user = userEvent.setup();
    renderAdmin(<NewPurchaseOrder supplierId={3} branchId={1} />);
    await waitFor(() => expect(screen.getByLabelText(/^Supplier/)).toHaveValue("3"));
    await waitFor(() => expect(screen.getByText(/Usual lead time 2 days/)).toBeInTheDocument());
    await pickRice(user);
    expect(screen.getByLabelText("Unit cost")).toHaveValue("1.05");
    expect(screen.getByText("From catalogue")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Quantity"), "3");
    expect(screen.getByLabelText("Line 1 total")).toHaveTextContent("$3.15");
    expect(screen.getByText(/Order total/).parentElement).toHaveTextContent("$3.15");
    // 3 x 0.1 is 0.30000000000000004 with floats; here it is exactly 0.30.
    await user.clear(screen.getByLabelText("Unit cost"));
    await user.type(screen.getByLabelText("Unit cost"), "0.1");
    expect(screen.getByLabelText("Line 1 total")).toHaveTextContent("$0.30");
    expect(screen.queryByText("From catalogue")).not.toBeInTheDocument();
  });

  it("creates the draft with decimal strings and opens it", async () => {
    const api = mockApi({ ...routes, "POST /admin/purchase-orders/": { json: purchaseOrder({ id: 77, status: "DRAFT", status_label: "Draft" }) } });
    const user = userEvent.setup();
    renderAdmin(<NewPurchaseOrder supplierId={3} branchId={1} />);
    await waitFor(() => expect(screen.getByLabelText(/^Supplier/)).toHaveValue("3"));
    await pickRice(user);
    await user.type(screen.getByLabelText("Quantity"), "20");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin/purchase-orders/77"));
    expect(api.calls.find((c) => c.key === "POST /admin/purchase-orders/")!.body).toEqual({
      supplier_id: 3, branch_id: 1, notes: "", lines: [{ product_id: 11, qty_ordered: "20", unit_cost: "1.05" }],
    });
  });

  it("checks the obvious things before sending", async () => {
    const api = mockApi(routes);
    const user = userEvent.setup();
    renderAdmin(<NewPurchaseOrder />);
    await user.click(await screen.findByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Choose a supplier.")).toBeInTheDocument();
    expect(screen.getByText("Choose the store the goods are delivered to.")).toBeInTheDocument();
    expect(screen.getByText("Choose a product.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key.startsWith("POST"))).toHaveLength(0);
  });

  it("shows the server's message and field errors, and doesn't navigate", async () => {
    mockApi({
      ...routes,
      "POST /admin/purchase-orders/": apiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { lines: [{ qty_ordered: ["Ensure this value is greater than or equal to 0.001."] }] }),
    });
    const user = userEvent.setup();
    renderAdmin(<NewPurchaseOrder supplierId={3} branchId={1} />);
    await waitFor(() => expect(screen.getByLabelText(/^Supplier/)).toHaveValue("3"));
    await pickRice(user);
    await user.type(screen.getByLabelText("Quantity"), "1");
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByText("Ensure this value is greater than or equal to 0.001.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("is hidden from staff who can't write purchase orders", async () => {
    mockApi(routes);
    renderAdmin(<NewPurchaseOrder />, ["purchasing.read"]);
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
});

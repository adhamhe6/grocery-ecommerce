import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Replenishment } from "@/components/admin/purchasing/replenishment";
import type { ReplenishmentRow } from "@/components/admin/purchasing/types";
import { apiError, mockApi, purchaseOrder, renderAdmin } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const row = (over: Partial<ReplenishmentRow> = {}): ReplenishmentRow => ({
  product_id: 1, sku: "RICE", name: "Basmati rice 1kg", unit: "ea", available: "3", threshold: "10", on_order: "0", avg_daily_sales: "1.5", days_of_cover: "2", suggested_qty: "17",
  suppliers: [{ id: 1, name: "Grain Co", unit_cost: "1.90", lead_time_days: 3 }, { id: 2, name: "Cheap Grain", unit_cost: "1.50", lead_time_days: 5 }], ...over,
});
const URL = "GET /admin/purchasing/replenishment/";

describe("Replenishment", () => {
  it("shows the service's rules in plain words", async () => {
    mockApi({ [URL]: { json: [row()] } });
    renderAdmin(<Replenishment />);
    await screen.findByText("Basmati rice 1kg");
    const details = screen.getByText("How suggestions are worked out").closest("details")!;
    expect(details).toHaveTextContent("2 × the threshold − available stock");
    expect(details).toHaveTextContent("does not subtract what is already on order");
    expect(details).toHaveTextContent("last 30 days");
  });

  it("defaults each product to its cheapest listed supplier and lets you change it", async () => {
    mockApi({ [URL]: { json: [row()] } });
    const user = userEvent.setup();
    renderAdmin(<Replenishment />);
    const select = await screen.findByLabelText("Supplier for Basmati rice 1kg");
    expect(select).toHaveValue("2"); // $1.50 beats $1.90
    expect(screen.getByLabelText("Unit cost for Basmati rice 1kg")).toHaveValue("1.50");
    await user.selectOptions(select, "1");
    expect(screen.getByLabelText("Unit cost for Basmati rice 1kg")).toHaveValue("1.90");
    expect(screen.getByLabelText("Order quantity for Basmati rice 1kg")).toHaveValue("17");
  });

  it("can't select a product that no supplier lists", async () => {
    mockApi({ [URL]: { json: [row({ suppliers: [] })] } });
    renderAdmin(<Replenishment />);
    expect(await screen.findByLabelText("Select Basmati rice 1kg")).toBeDisabled();
    expect(screen.getByText(/No active supplier lists this product/)).toBeInTheDocument();
  });

  it("creates one draft purchase order per supplier from the selected rows", async () => {
    const api = mockApi({
      [URL]: { json: [row(), row({ product_id: 2, sku: "MILK", name: "Whole milk 1L", suppliers: [{ id: 2, name: "Cheap Grain", unit_cost: "0.85", lead_time_days: 5 }], suggested_qty: "24" }),
        row({ product_id: 3, sku: "TEA", name: "Green tea", suppliers: [{ id: 5, name: "Leaf Ltd", unit_cost: null, lead_time_days: 2 }], suggested_qty: "6" })] },
      "POST /admin/purchase-orders/": (req) => ({ json: purchaseOrder({ id: req.body.supplier_id * 10, number: `PO-${req.body.supplier_id}`, line_count: req.body.lines.length }) }),
    });
    const user = userEvent.setup();
    renderAdmin(<Replenishment />);
    await user.click(await screen.findByLabelText("Select Basmati rice 1kg"));
    await user.click(screen.getByLabelText("Select Whole milk 1L"));
    await user.click(screen.getByLabelText("Select Green tea"));
    // Green tea has no cost on file, so the button waits until one is entered.
    expect(screen.getByRole("button", { name: /Create draft PO/ })).toBeDisabled();
    expect(screen.getByText(/Fix the 1 marked row to continue/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Unit cost for Green tea"), "4.20");
    await user.click(screen.getByRole("button", { name: "Create draft POs" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Create 2 draft purchase orders?")).toBeInTheDocument();
    expect(within(dialog).getByText("$45.90")).toBeInTheDocument(); // Cheap Grain: 17 x 1.50 + 24 x 0.85 = 25.50 + 20.40
    expect(within(dialog).getByText("$25.20")).toBeInTheDocument(); // Leaf Ltd: 6 x 4.20
    await user.click(within(dialog).getByRole("button", { name: "Create drafts" }));
    await waitFor(() => expect(api.calls.filter((c) => c.key === "POST /admin/purchase-orders/")).toHaveLength(2));
    const bodies = api.calls.filter((c) => c.key === "POST /admin/purchase-orders/").map((c) => c.body);
    expect(bodies[0]).toMatchObject({ supplier_id: 2, branch_id: 1, lines: [{ product_id: 1, qty_ordered: "17", unit_cost: "1.50" }, { product_id: 2, qty_ordered: "24", unit_cost: "0.85" }] });
    expect(bodies[1]).toMatchObject({ supplier_id: 5, branch_id: 1, lines: [{ product_id: 3, qty_ordered: "6", unit_cost: "4.20" }] });
    expect(await screen.findByRole("link", { name: "PO-2" })).toHaveAttribute("href", "/admin/purchase-orders/20");
  });

  it("reports a refused draft against its supplier and keeps those rows selected", async () => {
    mockApi({
      [URL]: { json: [row()] },
      "POST /admin/purchase-orders/": apiError(400, "VALIDATION_ERROR", "Cheap Grain is on hold and can't receive new orders."),
    });
    const user = userEvent.setup();
    renderAdmin(<Replenishment />);
    await user.click(await screen.findByLabelText("Select Basmati rice 1kg"));
    await user.click(screen.getByRole("button", { name: "Create draft PO" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Create drafts" }));
    expect(await screen.findByText(/not created\. Cheap Grain is on hold/)).toBeInTheDocument();
    expect(screen.getByLabelText("Select Basmati rice 1kg")).toBeChecked();
  });

  it("is view-only without purchasing.write", async () => {
    mockApi({ [URL]: { json: [row()] } });
    renderAdmin(<Replenishment />, ["purchasing.read"]);
    await screen.findByText("Basmati rice 1kg");
    expect(screen.queryByLabelText("Select Basmati rice 1kg")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create draft PO/ })).not.toBeInTheDocument();
  });

  it("has an honest empty state", async () => {
    mockApi({ [URL]: { json: [] } });
    renderAdmin(<Replenishment />);
    expect(await screen.findByText("Nothing to reorder")).toBeInTheDocument();
  });
});

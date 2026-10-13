import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdjustDialog, TransferDialog, WasteDialog, type StockTarget } from "@/components/admin/inventory/stock-dialogs";
import { apiError, list, mockApi, renderAdmin } from "../purchasing/helpers";

afterEach(() => vi.unstubAllGlobals());

const preview = async () => (await screen.findByText(/After this adjustment:/)).closest("[role=status]") as HTMLElement;

const rice: StockTarget = { productId: 5, name: "Basmati rice 1kg", sku: "RICE", unit: "ea", tracksBatches: false, branchId: 1, branchName: "Main store", onHand: "20", reserved: "5", available: "15" };
const yoghurt: StockTarget = { productId: 6, name: "Yoghurt 500g", sku: "YOG", unit: "ea", tracksBatches: true, branchId: 1, branchName: "Main store" };
const batch = (id: number, lot: string, over: Record<string, unknown> = {}) => ({
  id, product_id: 6, sku: "YOG", name: "Yoghurt 500g", unit: "ea", branch: "Main store", branch_id: 1, lot_code: lot, supplier: null, received_on: "2026-10-01", expiry_date: "2026-10-20", expiry_kind: "BEST_BEFORE",
  sellable_until: "2026-10-19", days_to_expiry: 8, qty_received: "10", qty_remaining: "10", qty_reserved: "2", unit_cost: "1.1000", value: "11.00", status: "ACTIVE", quality_status: "PASSED", is_demo: false, risk: "OK", can_sell: true, ...over,
});

describe("AdjustDialog", () => {
  it("previews the resulting count exactly and sends a counted quantity with the reason", async () => {
    const api = mockApi({ "POST /admin/inventory/adjust/": { json: { movement_id: 1, changed: true, on_hand_after: "18" } } });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<AdjustDialog target={rice} onClose={onClose} />);
    await user.type(screen.getByLabelText(/Counted quantity/), "18");
    expect(await preview()).toHaveTextContent("After this adjustment: 18 ea (-2 ea)");
    await user.type(screen.getByLabelText(/^Reason/), "monthly stock take");
    await user.click(screen.getByRole("button", { name: "Save adjustment" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.key === "POST /admin/inventory/adjust/")!.body).toEqual({ product_id: 5, branch_id: 1, target: "18", reason: "monthly stock take" });
  });

  it("supports a signed change and warns when it dips below what is reserved", async () => {
    mockApi({});
    const user = userEvent.setup();
    renderAdmin(<AdjustDialog target={rice} onClose={vi.fn()} />);
    await user.click(screen.getByRole("radio", { name: /Add or remove/ }));
    await user.type(screen.getByLabelText(/^Change/), "-8");
    expect(await preview()).toHaveTextContent("12 ea (-8 ea)");
    expect(screen.queryByText("Below what is reserved")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Change/));
    await user.type(screen.getByLabelText(/^Change/), "-16");
    expect(await preview()).toHaveTextContent("4 ea (-16 ea)");
    expect(screen.getByText("Below what is reserved")).toBeInTheDocument();
  });

  it("requires a reason before anything is sent", async () => {
    const api = mockApi({});
    const user = userEvent.setup();
    renderAdmin(<AdjustDialog target={rice} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/Counted quantity/), "18");
    await user.click(screen.getByRole("button", { name: "Save adjustment" }));
    expect(await screen.findByText("A reason is required for every adjustment.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key.startsWith("POST"))).toHaveLength(0);
  });

  it("shows the server's refusal verbatim and stays open", async () => {
    mockApi({ "POST /admin/inventory/adjust/": apiError(409, "INSUFFICIENT_STOCK", "Can't reduce stock below the 5 already reserved for customer orders.") });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<AdjustDialog target={rice} onClose={onClose} />);
    await user.type(screen.getByLabelText(/Counted quantity/), "2");
    await user.type(screen.getByLabelText(/^Reason/), "recount");
    await user.click(screen.getByRole("button", { name: "Save adjustment" }));
    expect(await screen.findByText("Can't reduce stock below the 5 already reserved for customer orders.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("adjusts a batch-tracked product one batch at a time, based on that batch's quantity", async () => {
    const api = mockApi({
      "GET /admin/inventory/batches/": { json: list([batch(31, "Y-1"), batch(32, "Y-2", { qty_remaining: "4", qty_reserved: "0" })]) },
      "POST /admin/inventory/adjust/": { json: { movement_id: 2, changed: true, on_hand_after: "13" } },
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<AdjustDialog target={yoghurt} onClose={onClose} />);
    await screen.findByRole("option", { name: /Y-1/ });
    await user.selectOptions(screen.getByLabelText(/^Batch/), "31");
    await user.type(screen.getByLabelText(/Counted quantity/), "9");
    expect(await preview()).toHaveTextContent("9 ea (-1 ea, in this batch)");
    await user.type(screen.getByLabelText(/^Reason/), "recount");
    await user.click(screen.getByRole("button", { name: "Save adjustment" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.key === "POST /admin/inventory/adjust/")!.body).toMatchObject({ batch_id: 31, target: "9" });
  });

  it("asks for the batch when the product is batch-tracked", async () => {
    mockApi({ "GET /admin/inventory/batches/": { json: list([batch(31, "Y-1")]) } });
    const user = userEvent.setup();
    renderAdmin(<AdjustDialog target={yoghurt} onClose={vi.fn()} />);
    await screen.findByRole("option", { name: /Y-1/ });
    await user.type(screen.getByLabelText(/Counted quantity/), "9");
    await user.type(screen.getByLabelText(/^Reason/), "x");
    await user.click(screen.getByRole("button", { name: "Save adjustment" }));
    expect(await screen.findByText("Choose the batch you counted.")).toBeInTheDocument();
  });
});

describe("WasteDialog", () => {
  it("limits the quantity to what is available and sends the reason code", async () => {
    const api = mockApi({ "POST /admin/inventory/waste/": { json: { movement_id: 3, on_hand_after: "18" } } });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<WasteDialog target={rice} onClose={onClose} />);
    await user.selectOptions(screen.getByLabelText(/^Reason/), "DAMAGED");
    await user.type(screen.getByLabelText(/^Quantity/), "16");
    await user.click(screen.getByRole("button", { name: "Record waste" }));
    expect(await screen.findByText(/more than the 15 available/)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key.startsWith("POST"))).toHaveLength(0);
    await user.clear(screen.getByLabelText(/^Quantity/));
    await user.type(screen.getByLabelText(/^Quantity/), "2");
    await user.click(screen.getByRole("button", { name: "Record waste" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.key === "POST /admin/inventory/waste/")!.body).toEqual({ product_id: 5, branch_id: 1, quantity: "2", reason_code: "DAMAGED" });
  });

  it("opens prefilled for an expired batch and can write off all of it, even with stale reservations", async () => {
    const api = mockApi({
      "GET /admin/inventory/batches/": { json: list([batch(40, "OLD", { status: "EXPIRED", days_to_expiry: -2, qty_remaining: "10", qty_reserved: "3" })]) },
      "POST /admin/inventory/waste/": { json: { movement_id: 4, on_hand_after: "0" } },
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<WasteDialog target={yoghurt} initial={{ batchId: 40, quantity: "10", reason: "EXPIRED" }} onClose={onClose} />);
    await screen.findByRole("option", { name: /OLD/ });
    await waitFor(() => expect(screen.getByLabelText(/^Batch/)).toHaveValue("40"));
    expect(screen.getByLabelText(/^Reason/)).toHaveValue("EXPIRED");
    expect(screen.getByLabelText(/^Quantity/)).toHaveValue("10");
    await user.click(screen.getByRole("button", { name: "Record waste" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.key === "POST /admin/inventory/waste/")!.body).toEqual({ product_id: 6, branch_id: 1, batch_id: 40, quantity: "10", reason_code: "EXPIRED" });
  });
});

describe("TransferDialog", () => {
  it("transfers to the other store, limited to what is available", async () => {
    const api = mockApi({ "POST /admin/inventory/transfer/": { json: { out_movement_id: 1, in_movement_id: 2 } } });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<TransferDialog target={rice} onClose={onClose} />);
    expect(screen.getByLabelText("From")).toHaveValue("Main store");
    await user.selectOptions(screen.getByLabelText(/^To/), "2");
    await user.type(screen.getByLabelText(/^Quantity/), "15.5");
    await user.click(screen.getByRole("button", { name: "Transfer" }));
    expect(await screen.findByText(/more than the 15 available to transfer/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/^Quantity/));
    await user.type(screen.getByLabelText(/^Quantity/), "5");
    await user.click(screen.getByRole("button", { name: "Transfer" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.calls.find((c) => c.key === "POST /admin/inventory/transfer/")!.body).toEqual({ product_id: 5, from_branch_id: 1, to_branch_id: 2, quantity: "5" });
  });
});

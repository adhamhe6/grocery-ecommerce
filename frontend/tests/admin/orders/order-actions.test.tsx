import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrderActions } from "@/components/admin/orders/order-actions";
import { apiError, capturedOrder, item, mockApi, order, MANAGER_CAPS, PICKER_CAPS, renderAdmin } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/orders/OR-1", useSearchParams: () => new URLSearchParams() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const names = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("OrderActions: which buttons appear", () => {
  it("shows start + cancel to a manager, only start to a picker", () => {
    renderAdmin(<OrderActions order={order()} />, MANAGER_CAPS);
    expect(names()).toEqual(["Start picking", "Cancel order"]);
    cleanup();
    renderAdmin(<OrderActions order={order()} />, PICKER_CAPS);
    expect(names()).toEqual(["Start picking"]);
  });

  it("renders nothing for a finished order", () => {
    renderAdmin(<OrderActions order={order({ status: "COMPLETED", allowed_transitions: [] })} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("follows the pickup path for pickup orders", () => {
    renderAdmin(<OrderActions order={order({ status: "PACKING", fulfilment_type: "PICKUP", allowed_transitions: ["CANCELLED", "PICKING", "READY_FOR_PICKUP"] })} />);
    expect(names()).toEqual(["Packed — ready for pickup", "Reopen picking", "Cancel order"]);
  });
});

describe("OrderActions: doing things", () => {
  it("starts picking straight away and reports the fresh order", async () => {
    const api = mockApi({ "POST /admin/orders/OR-1/start-picking/": { json: order({ status: "PICKING", allowed_transitions: ["CANCELLED", "PACKING"] }) } });
    const onDone = vi.fn();
    renderAdmin(<OrderActions order={order()} onDone={onDone} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Start picking" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0][0].key).toBe("start-picking");
    expect(onDone.mock.calls[0][1].status).toBe("PICKING");
    expect(api.calls.map((c) => c.key)).toEqual(["POST /admin/orders/OR-1/start-picking/"]);
  });

  it("shows a refusal under the buttons when there is no dialog", async () => {
    mockApi({ "POST /admin/orders/OR-1/start-picking/": apiError(409, "INVALID_ORDER_TRANSITION", "Order OR-1 can't move from Being picked to Being picked.") });
    renderAdmin(<OrderActions order={order()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Start picking" }));
    expect(await screen.findByText(/can't move from being picked/i)).toBeInTheDocument();
  });

  it("blocks 'Finish picking' while lines are open, and says how many", () => {
    const o = order({ status: "PICKING", allowed_transitions: ["CANCELLED", "PACKING"], items: [item({ id: 1, status: "PICKED" }), item({ id: 2, status: "PENDING" }), item({ id: 3, status: "UNAVAILABLE" })] });
    renderAdmin(<OrderActions order={o} />);
    expect(screen.getByRole("button", { name: "Finish picking" })).toBeDisabled();
    expect(screen.getByText("2 lines are still to do.")).toBeInTheDocument();
  });

  it("waits for the customer when only a substitution is outstanding", () => {
    const o = order({ status: "PICKING", allowed_transitions: ["CANCELLED", "PACKING"], items: [item({ id: 1, status: "PICKED" }), item({ id: 3, status: "PROPOSED", is_substitute: true, substitute_for: 2 })] });
    renderAdmin(<OrderActions order={o} />);
    expect(screen.getByText(/waiting for the customer to answer a substitution/i)).toBeInTheDocument();
  });

  it("confirms before finishing picking and hands the API's list of unfinished lines to the page", async () => {
    mockApi({ "POST /admin/orders/OR-1/finish-picking/": apiError(409, "INVALID_STATE", "Finish every item before packing: Cheddar.", { item_ids: [11] }) });
    const onFailure = vi.fn();
    const o = order({ status: "PICKING", allowed_transitions: ["CANCELLED", "PACKING"], items: [item({ status: "PICKED", picked_qty: "1.5" })] });
    renderAdmin(<OrderActions order={o} onFailure={onFailure} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Finish picking" }));
    expect(screen.getByRole("heading", { name: "Finish picking?" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Finish picking" }).at(-1)!);
    expect(await screen.findByText("Finish every item before packing: Cheddar.")).toBeInTheDocument();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][1].details).toEqual({ item_ids: [11] });
  });

  it("warns that finishing with nothing picked cancels the order", async () => {
    const o = order({ status: "PICKING", allowed_transitions: ["CANCELLED", "PACKING"], items: [item({ status: "REMOVED" })] });
    renderAdmin(<OrderActions order={o} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Finish picking" }));
    expect(screen.getByText("Nothing has been picked")).toBeInTheDocument();
  });

  it("warns that packing captures the card payment", async () => {
    renderAdmin(<OrderActions order={order({ status: "PACKING", payment_method: "CARD", allowed_transitions: ["CANCELLED", "PICKING", "READY_FOR_DISPATCH"] })} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Packed — ready for dispatch" }));
    expect(screen.getByText(/captures the card payment/i)).toBeInTheDocument();
  });
});

describe("OrderActions: cash on delivery handover", () => {
  const cod = order({ status: "OUT_FOR_DELIVERY", payment_method: "COD", allowed_transitions: ["CANCELLED", "COMPLETED", "READY_FOR_DISPATCH"], totals: { ...order().totals, final_total: "14.00" } });

  it("asks for the amount collected, prefilled with what is due, and posts it as a decimal string", async () => {
    const api = mockApi({ "POST /admin/orders/OR-1/complete/": { json: order({ status: "COMPLETED", allowed_transitions: [] }) } });
    const onDone = vi.fn();
    renderAdmin(<OrderActions order={cod} onDone={onDone} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mark delivered" }));
    expect(screen.getByText("$14.00 is due in cash")).toBeInTheDocument();
    expect(screen.getByLabelText(/amount collected/i)).toHaveValue("14.00");
    await user.type(screen.getByLabelText(/receipt or reference/i), "drawer-3");
    await user.click(screen.getAllByRole("button", { name: "Mark delivered" }).at(-1)!);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.calls[0].body).toEqual({ collected_amount: "14.00", reference: "drawer-3" });
  });

  it("validates the amount locally and shows the server's mismatch message", async () => {
    mockApi({ "POST /admin/orders/OR-1/complete/": apiError(400, "VALIDATION_ERROR", "The amount collected must match the amount due (14.00).", { due: "14.00" }) });
    renderAdmin(<OrderActions order={cod} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mark delivered" }));
    const amount = screen.getByLabelText(/amount collected/i);
    await user.clear(amount);
    await user.type(amount, "abc");
    await user.click(screen.getAllByRole("button", { name: "Mark delivered" }).at(-1)!);
    expect(await screen.findByText("Enter the amount collected, like 14.00.")).toBeInTheDocument();
    await user.clear(amount);
    await user.type(amount, "1");
    await user.click(screen.getAllByRole("button", { name: "Mark delivered" }).at(-1)!);
    expect(await screen.findByText("The amount collected must match the amount due (14.00).")).toBeInTheDocument();
  });

  it("sends no body for a prepaid order", async () => {
    const api = mockApi({ "POST /admin/orders/OR-1/complete/": { json: order({ status: "COMPLETED", allowed_transitions: [] }) } });
    renderAdmin(<OrderActions order={{ ...cod, payment_method: "CARD" }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mark delivered" }));
    expect(screen.queryByLabelText(/amount collected/i)).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Mark delivered" }).at(-1)!);
    await waitFor(() => expect(api.calls).toHaveLength(1));
    expect(api.calls[0].body).toBeUndefined();
  });
});

describe("OrderActions: cancelling", () => {
  it("explains the consequences, requires a reason and posts it", async () => {
    const api = mockApi({ "POST /admin/orders/OR-1/cancel/": { json: order({ status: "CANCELLED", allowed_transitions: [] }) } });
    const onDone = vi.fn();
    renderAdmin(<OrderActions order={capturedOrder({ status: "PICKING", allowed_transitions: ["CANCELLED", "PACKING"] })} onDone={onDone} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancel order" }));
    expect(screen.getByText(/stock is released/i)).toBeInTheDocument();
    expect(screen.getByText(/\$20\.00 already collected is refunded in full/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel this order" }));
    expect(await screen.findByText(/say why the order is being cancelled/i)).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
    await user.type(screen.getByLabelText(/reason for cancelling/i), "Customer phoned");
    await user.click(screen.getByRole("button", { name: "Cancel this order" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.calls[0].body).toEqual({ reason: "Customer phoned" });
    expect(onDone.mock.calls[0][0].key).toBe("cancel");
  });

  it("says no money was taken when nothing has been collected", async () => {
    renderAdmin(<OrderActions order={order()} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel order" }));
    expect(screen.getByText(/nothing to refund/i)).toBeInTheDocument();
  });
});

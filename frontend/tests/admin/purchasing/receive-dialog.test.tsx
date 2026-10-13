import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReceiveDialog } from "@/components/admin/purchasing/po-receive";
import { apiError, mockApi, purchaseOrder, renderAdmin } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

const URL = "POST /admin/purchase-orders/9/receive/";
const received = (replayed = false) => ({ json: { ...purchaseOrder({ status: "PARTIALLY_RECEIVED", status_label: "Partially received" }), receipt: { number: "GR-261012-WXYZ", replayed } } });

async function fillYoghurt(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Accepted \(ea\)/, { selector: "#rcv-1-acc" }), "38");
  await user.type(document.getElementById("rcv-1-lot") as HTMLElement, "Y-1012");
  fireEvent.change(document.getElementById("rcv-1-exp") as HTMLElement, { target: { value: "2026-11-01" } });
}

describe("ReceiveDialog", () => {
  it("lists only lines with something outstanding and shows what each costs", async () => {
    mockApi({});
    renderAdmin(<ReceiveDialog po={purchaseOrder({ lines: [purchaseOrder().lines[0], { ...purchaseOrder().lines[1], outstanding: "0", qty_received: "20" }] })} onClose={vi.fn()} onReplayed={vi.fn()} />);
    expect(await screen.findByText(/Yoghurt/)).toBeInTheDocument();
    expect(screen.queryByText(/Rice 1kg/)).not.toBeInTheDocument();
    expect(screen.getByText(/already received in full/)).toBeInTheDocument();
    expect(screen.getByText(/\$1\.10 each \(price on the order\)/)).toBeInTheDocument();
  });

  it("won't send until a batch-tracked line has a lot code and an expiry date", async () => {
    const api = mockApi({ [URL]: received() });
    const user = userEvent.setup();
    renderAdmin(<ReceiveDialog po={purchaseOrder()} onClose={vi.fn()} onReplayed={vi.fn()} />);
    await user.type(document.getElementById("rcv-1-acc") as HTMLElement, "38");
    await user.click(screen.getByRole("button", { name: "Record delivery" }));
    expect(await screen.findByText("A lot code is required for batch-tracked products.")).toBeInTheDocument();
    expect(screen.getByText("An expiry date is required for batch-tracked products.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key === URL)).toHaveLength(0);
  });

  it("asks for at least one line, and a reason for rejected units", async () => {
    const api = mockApi({ [URL]: received() });
    const user = userEvent.setup();
    renderAdmin(<ReceiveDialog po={purchaseOrder()} onClose={vi.fn()} onReplayed={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Record delivery" }));
    expect(await screen.findByText("Enter an accepted or rejected quantity on at least one line.")).toBeInTheDocument();
    await user.type(document.getElementById("rcv-2-rej") as HTMLElement, "2");
    expect(await screen.findByLabelText(/Why rejected/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record delivery" }));
    expect(await screen.findByText("Say why it was rejected.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key === URL)).toHaveLength(0);
  });

  it("warns about over-receipt within the tolerance and refuses beyond it", async () => {
    mockApi({});
    const user = userEvent.setup();
    renderAdmin(<ReceiveDialog po={purchaseOrder()} onClose={vi.fn()} onReplayed={vi.fn()} />);
    await user.type(document.getElementById("rcv-2-acc") as HTMLElement, "22");
    expect(await screen.findByText(/2 ea more than outstanding/)).toBeInTheDocument();
    await user.clear(document.getElementById("rcv-2-acc") as HTMLElement);
    await user.type(document.getElementById("rcv-2-acc") as HTMLElement, "23");
    await user.click(screen.getByRole("button", { name: "Record delivery" }));
    expect(await screen.findByText(/That is more than the 22 that can be accepted/)).toBeInTheDocument();
  });

  it("sends the receipt with an idempotency key and closes on success", async () => {
    const api = mockApi({ [URL]: received() });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<ReceiveDialog po={purchaseOrder()} onClose={onClose} onReplayed={vi.fn()} />);
    await fillYoghurt(user);
    await user.type(screen.getByLabelText(/Delivery note number/), "DN-77");
    await user.click(screen.getByRole("button", { name: "Record delivery" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const body = api.calls.find((c) => c.key === URL)!.body;
    expect(body.idempotency_key).toMatch(/^.{8,80}$/);
    expect(body.delivery_note).toBe("DN-77");
    expect(body.lines).toEqual([{ po_line_id: 1, qty_accepted: "38", qty_rejected: "0", lot_code: "Y-1012", expiry_date: "2026-11-01", expiry_kind: "BEST_BEFORE" }]);
  });

  it("shows the server's message verbatim and reuses the same key when you retry", async () => {
    let n = 0;
    const api = mockApi({ [URL]: () => (++n === 1 ? apiError(409, "VALIDATION_ERROR", "Yoghurt: 38 is more than the 30 still outstanding (up to 10% over is accepted).") : received().json && received()) });
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<ReceiveDialog po={purchaseOrder()} onClose={onClose} onReplayed={vi.fn()} />);
    await fillYoghurt(user);
    await user.click(screen.getByRole("button", { name: "Record delivery" }));
    const message = await screen.findByText("Yoghurt: 38 is more than the 30 still outstanding (up to 10% over is accepted).");
    expect(within(message.closest("[role=alert]") as HTMLElement).getByText("That didn't go through")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Record delivery" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const keys = api.calls.filter((c) => c.key === URL).map((c) => c.body.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("says so gracefully when the server recognises the delivery as already received", async () => {
    mockApi({ [URL]: received(true) });
    const onClose = vi.fn();
    const onReplayed = vi.fn();
    const user = userEvent.setup();
    renderAdmin(<ReceiveDialog po={purchaseOrder()} onClose={onClose} onReplayed={onReplayed} />);
    await fillYoghurt(user);
    await user.click(screen.getByRole("button", { name: "Record delivery" }));
    await waitFor(() => expect(onReplayed).toHaveBeenCalledWith("GR-261012-WXYZ"));
    expect(await screen.findByText("Already received")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("can't be submitted twice while the request is in flight", async () => {
    document.cookie = "csrftoken=test-token";
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const fetchMock = vi.fn(async () => { await gate; return new Response(JSON.stringify(received().json), { status: 200, headers: { "Content-Type": "application/json" } }); });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderAdmin(<ReceiveDialog po={purchaseOrder()} onClose={vi.fn()} onReplayed={vi.fn()} />);
    await fillYoghurt(user);
    await user.dblClick(screen.getByRole("button", { name: "Record delivery" }));
    await user.keyboard("{Enter}");
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Record delivery" })).not.toBeDisabled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

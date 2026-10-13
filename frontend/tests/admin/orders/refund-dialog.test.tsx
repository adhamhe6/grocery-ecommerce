import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefundDialog } from "@/components/admin/orders/refund-dialog";
import { apiError, capturedOrder, mockApi, order, renderAdmin } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/admin/orders/OR-1", useSearchParams: () => new URLSearchParams() }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const refundedOrder = (status: string, method = "PROVIDER", message = "") => {
  const base = capturedOrder();
  return { ...base, refunds: [{ id: 9, amount: "5.00", status, method, reason: "leaky", reference: "", failure: message, created_at: "2026-10-12T10:00:00Z", completed_at: null }], refund_result: { id: 9, status, message } };
};

function open(o = capturedOrder(), refundable: string | null = "20.00") {
  return renderAdmin(<RefundDialog order={o} refundable={refundable} open onOpenChange={() => {}} />);
}
const fill = async (amount: string, reason = "Leaking bottle") => {
  const user = userEvent.setup();
  if (amount) await user.type(screen.getByLabelText(/amount to refund/i), amount);
  if (reason) await user.type(screen.getByLabelText(/^reason/i), reason);
  return user;
};
const refundButton = () => screen.getByRole("button", { name: "Refund" });

describe("RefundDialog", () => {
  it("checks the obvious things locally and sends nothing", async () => {
    const api = mockApi({});
    open();
    const user = userEvent.setup();
    await user.click(refundButton());
    expect(await screen.findByText("Enter the amount to refund.")).toBeInTheDocument();
    expect(screen.getByText("Say why this refund is being made.")).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);

    await user.type(screen.getByLabelText(/amount to refund/i), "20.01");
    await user.click(refundButton());
    expect(await screen.findByText("At most $20.00 can still be refunded.")).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("posts exact decimal strings with an idempotency key and reports the outcome", async () => {
    const api = mockApi({ "POST /admin/orders/OR-1/refund/": { json: refundedOrder("SUCCEEDED") } });
    open();
    const user = await fill("5");
    await user.click(refundButton());
    expect(await screen.findByText(/refund of \$5\.00 issued/i)).toBeInTheDocument();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].body).toMatchObject({ amount: "5.00", reason: "Leaking bottle", manual: false });
    expect(api.calls[0].body.idempotency_key).toMatch(/^refund-OR-1-.{8,}/);
  });

  it("never claims a manual refund is done: it is pending until the payout is recorded", async () => {
    mockApi({ "POST /admin/orders/OR-1/refund/": { json: refundedOrder("PENDING", "MANUAL") } });
    open(order({ payment_method: "COD", payments: [{ id: 1, provider: "cod", method: "COD", state: "CAPTURED", amount: "14.00", captured: "14.00", refunded: "0.00", attempt: 1, reference: "", failure: "", is_demo: false }] }), "14.00");
    expect(screen.getByText(/paid out by hand/i)).toBeInTheDocument();
    const user = await fill("5");
    await user.click(refundButton());
    expect(await screen.findByText(/not paid out yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/issued/i)).not.toBeInTheDocument();
  });

  it("shows the server's refusal inside the dialog and keeps the form for another try", async () => {
    mockApi({ "POST /admin/orders/OR-1/refund/": apiError(409, "REFUND_NOT_ALLOWED", "At most 12.00 can still be refunded on this order.") });
    open();
    const user = await fill("5");
    await user.click(refundButton());
    const alert = await screen.findByText("At most 12.00 can still be refunded on this order.");
    expect(within(alert.closest("[role=alert]") as HTMLElement).getByText(/Reference: req-1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount to refund/i)).toHaveValue("5");
    expect(refundButton()).toBeEnabled();
  });

  it("maps field errors from the API onto the fields", async () => {
    mockApi({ "POST /admin/orders/OR-1/refund/": apiError(400, "VALIDATION_ERROR", "Please check the form.", { reason: ["Ensure this field has no more than 300 characters."] }) });
    open();
    const user = await fill("5");
    await user.click(refundButton());
    expect(await screen.findByText("Ensure this field has no more than 300 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^reason/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("sends only one request for a double click", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const api = mockApi({ "POST /admin/orders/OR-1/refund/": () => ({ json: refundedOrder("SUCCEEDED") }) });
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (...args: Parameters<typeof fetch>) => { await gate; return (original as typeof fetch)(...args); }));
    open();
    const user = await fill("5");
    const button = refundButton();
    await user.dblClick(button);
    expect(button).toBeDisabled();
    release();
    await screen.findByText(/refund of \$5\.00 issued/i);
    expect(api.calls).toHaveLength(1);
  });

  it("re-sends the same key when the identical request is retried, and a new key when anything changes", async () => {
    const api = mockApi({
      "POST /admin/orders/OR-1/refund/": () => (api.calls.length === 1 ? { status: 502, json: { error: { code: "BAD_GATEWAY", message: "Try again", details: {} } } } : { json: refundedOrder("SUCCEEDED") }),
    });
    open();
    const user = await fill("5");
    await user.click(refundButton());
    await screen.findByText("Try again");
    await user.click(refundButton()); // same content -> same key
    await screen.findByText(/refund of \$5\.00 issued/i);
    expect(api.calls).toHaveLength(2);
    expect(api.calls[1].body.idempotency_key).toBe(api.calls[0].body.idempotency_key);
  });

  it("mints a fresh key when the amount changes between attempts", async () => {
    const api = mockApi({ "POST /admin/orders/OR-1/refund/": () => ({ status: 409, json: { error: { code: "REFUND_NOT_ALLOWED", message: "No", details: {} } } }) });
    open();
    const user = await fill("5");
    await user.click(refundButton());
    await screen.findByText("No");
    await user.clear(screen.getByLabelText(/amount to refund/i));
    await user.type(screen.getByLabelText(/amount to refund/i), "6");
    await user.click(refundButton());
    await waitFor(() => expect(api.calls).toHaveLength(2));
    expect(api.calls[1].body.idempotency_key).not.toBe(api.calls[0].body.idempotency_key);
    expect(api.calls[1].body.amount).toBe("6.00");
  });

  it("fills the whole refundable amount on request", async () => {
    mockApi({});
    open(capturedOrder(), "13.37");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Full amount" }));
    expect(screen.getByLabelText(/amount to refund/i)).toHaveValue("13.37");
  });
});

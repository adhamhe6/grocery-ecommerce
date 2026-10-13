import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefundDialog } from "@/components/admin/finance/refund-dialog";
import type { PaymentDetail } from "@/components/admin/finance/types";
import { apiError, mockApi, renderAdmin } from "./helpers";

const payment = (over: Partial<PaymentDetail> = {}): PaymentDetail => ({
  id: 7, order: "ORD-1001", branch: "Central", provider: "demo", method: "CARD", state: "PARTIALLY_REFUNDED", state_label: "Partially refunded",
  amount: "25.00", captured: "20.00", refunded: "5.00", currency: "USD", reference: "demo_pi_x", attempt: 1, failure_code: "", failure_message: "",
  created_at: "2026-10-12T09:00:00Z", captured_at: "2026-10-12T09:05:00Z", is_demo: true, events: [],
  refunds: [{ id: 1, amount: "3.00", status: "PENDING", method: "MANUAL", reason: "x", reference: "", created_at: "2026-10-12T10:00:00Z" }],
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

async function fillAndReview(user: ReturnType<typeof userEvent.setup>, amount: string, reason = "Damaged in transit") {
  await user.clear(screen.getByLabelText(/refund amount/i));
  await user.type(screen.getByLabelText(/refund amount/i), amount);
  await user.type(screen.getByLabelText(/reason/i), reason);
  await user.click(screen.getByRole("button", { name: /review refund/i }));
}

describe("RefundDialog", () => {
  it("works out what can still be refunded (captured − refunded − pending) and labels demo refunds as simulated", async () => {
    mockApi({ "GET /admin/payments/7/": { json: payment() } });
    renderAdmin(<RefundDialog paymentId={7} onClose={() => {}} />);
    expect(await screen.findByText("Can still refund")).toBeInTheDocument();
    expect(screen.getByText("$12.00", { selector: "dd" })).toBeInTheDocument(); // 20.00 − 5.00 − 3.00 pending
    expect(screen.getByText(/refunds are simulated/i)).toBeInTheDocument();
    expect(screen.getByText(/payment: simulated, no money moves/i)).toBeInTheDocument(); // the DEMO badge, with its screen-reader text
  });

  it("blocks an amount above the refundable limit without calling the API", async () => {
    const api = mockApi({ "GET /admin/payments/7/": { json: payment() } });
    const user = userEvent.setup();
    renderAdmin(<RefundDialog paymentId={7} onClose={() => {}} />);
    await screen.findByText("Can still refund");
    await fillAndReview(user, "12.01");
    expect(await screen.findByText(/at most \$12\.00 can still be refunded/i)).toBeInTheDocument();
    expect(api.of("POST /admin/orders/ORD-1001/refund/")).toHaveLength(0);
  });

  it("asks for a reason before reviewing", async () => {
    mockApi({ "GET /admin/payments/7/": { json: payment() } });
    const user = userEvent.setup();
    renderAdmin(<RefundDialog paymentId={7} onClose={() => {}} />);
    await screen.findByText("Can still refund");
    await user.type(screen.getByLabelText(/refund amount/i), "2");
    await user.click(screen.getByRole("button", { name: /review refund/i }));
    expect(await screen.findByText(/say why this refund/i)).toBeInTheDocument();
  });

  it("confirms first, and a retry after a server error re-sends the SAME idempotency key (no double refund)", async () => {
    const api = mockApi({
      "GET /admin/payments/7/": { json: payment() },
      "POST /admin/orders/ORD-1001/refund/": ({ n }) => (n === 1
        ? apiError(409, "REFUND_NOT_ALLOWED", "At most 9.00 can still be refunded on this order.", { refundable: "9.00" })
        : { json: { refund_result: { id: 5, status: "SUCCEEDED", message: "" } } }),
    });
    const user = userEvent.setup();
    renderAdmin(<RefundDialog paymentId={7} onClose={() => {}} />);
    await screen.findByText("Can still refund");
    await fillAndReview(user, "2.5");
    // review step: nothing has been sent yet
    expect(await screen.findByRole("button", { name: /confirm refund of \$2\.50/i })).toBeInTheDocument();
    expect(api.of("POST /admin/orders/ORD-1001/refund/")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /confirm refund of \$2\.50/i }));
    // the server's own sentence is shown — not the raw details object
    expect(await screen.findByText(/at most 9\.00 can still be refunded on this order\. \(reference req-1\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/^9\.00$/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm refund of \$2\.50/i }));
    await screen.findByText(/refund of \$2\.50 completed/i);
    const [first, second] = api.of("POST /admin/orders/ORD-1001/refund/");
    expect(first.body).toMatchObject({ amount: "2.50", reason: "Damaged in transit", manual: false });
    expect(first.body.idempotency_key.length).toBeGreaterThanOrEqual(8);
    expect(second.body.idempotency_key).toBe(first.body.idempotency_key);
    expect(screen.getByText(/demo payment: the refund is simulated and no money moved/i)).toBeInTheDocument();
  });

  it("an edited request gets a new idempotency key", async () => {
    const api = mockApi({
      "GET /admin/payments/7/": { json: payment() },
      "POST /admin/orders/ORD-1001/refund/": () => apiError(500, "ERROR", "Try again"),
    });
    const user = userEvent.setup();
    renderAdmin(<RefundDialog paymentId={7} onClose={() => {}} />);
    await screen.findByText("Can still refund");
    await fillAndReview(user, "2");
    await user.click(await screen.findByRole("button", { name: /confirm refund/i }));
    await waitFor(() => expect(api.of("POST /admin/orders/ORD-1001/refund/")).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /back/i }));
    await user.clear(screen.getByLabelText(/refund amount/i));
    await user.type(screen.getByLabelText(/refund amount/i), "3");
    await user.click(screen.getByRole("button", { name: /review refund/i }));
    await user.click(await screen.findByRole("button", { name: /confirm refund of \$3\.00/i }));
    await waitFor(() => expect(api.of("POST /admin/orders/ORD-1001/refund/")).toHaveLength(2));
    const [a, b] = api.of("POST /admin/orders/ORD-1001/refund/");
    expect(b.body.idempotency_key).not.toBe(a.body.idempotency_key);
  });

  it("cash on delivery is manual: the checkbox is replaced by an explanation and the result stays pending", async () => {
    const api = mockApi({
      "GET /admin/payments/7/": { json: payment({ provider: "cod", method: "COD", is_demo: false, refunded: "0.00", refunds: [] }) },
      "POST /admin/orders/ORD-1001/refund/": { json: { refund_result: { id: 9, status: "PENDING", message: "" } } },
    });
    const user = userEvent.setup();
    renderAdmin(<RefundDialog paymentId={7} onClose={() => {}} />);
    await screen.findByText("Can still refund");
    expect(screen.queryByLabelText(/refund manually/i)).not.toBeInTheDocument();
    expect(screen.getByText(/cash on delivery is refunded manually/i)).toBeInTheDocument();
    await fillAndReview(user, "20");
    await user.click(await screen.findByRole("button", { name: /confirm refund of \$20\.00/i }));
    expect(await screen.findByText(/recorded — pending/i)).toBeInTheDocument();
    expect(api.of("POST /admin/orders/ORD-1001/refund/")[0].body.manual).toBe(true);
    expect(screen.getByRole("button", { name: /record handover now/i })).toBeInTheDocument();
  });

  it("refuses to start for a payment that can't be refunded", async () => {
    mockApi({ "GET /admin/payments/7/": { json: payment({ state: "FAILED", state_label: "Failed", captured: "0.00", refunded: "0.00", refunds: [] }) } });
    renderAdmin(<RefundDialog paymentId={7} onClose={() => {}} />);
    expect(await screen.findByText(/this payment can't be refunded/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/refund amount/i)).not.toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import {
  availableActions, describeRefund, effectivePolicy, groupByZone, pickProgress, refundableAmount, sumCaptured, sumRefunded, validateRefundAmount, OPEN_STATUSES,
  type ActionableOrder,
} from "@/components/admin/orders/actions";
import type { FulfilmentTypeValue, StaffItem } from "@/components/admin/orders/types";

// A copy of backend/apps/orders/workflow.py TRANSITIONS / FULFILMENT_ONLY / allowed_next, so the test fails if the
// frontend ever stops covering a transition the backend allows.
const TRANSITIONS: Record<string, string[]> = {
  PENDING_PAYMENT: ["CONFIRMED", "CANCELLED", "PAYMENT_FAILED"],
  CONFIRMED: ["PICKING", "CANCELLED"],
  PICKING: ["PACKING", "CANCELLED"],
  PACKING: ["READY_FOR_PICKUP", "READY_FOR_DISPATCH", "PICKING", "CANCELLED"],
  READY_FOR_PICKUP: ["COMPLETED", "CANCELLED"],
  READY_FOR_DISPATCH: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["COMPLETED", "READY_FOR_DISPATCH", "CANCELLED"],
  COMPLETED: [], CANCELLED: [], PAYMENT_FAILED: [],
};
const FULFILMENT_ONLY: Record<string, FulfilmentTypeValue> = { READY_FOR_PICKUP: "PICKUP", READY_FOR_DISPATCH: "DELIVERY", OUT_FOR_DELIVERY: "DELIVERY" };
const allowedNext = (status: string, type: FulfilmentTypeValue) => TRANSITIONS[status].filter((t) => (FULFILMENT_ONLY[t] ?? type) === type).sort();

const order = (status: string, type: FulfilmentTypeValue, extra: Partial<ActionableOrder> = {}): ActionableOrder => ({ status, fulfilment_type: type, allowed_transitions: allowedNext(status, type), ...extra });
const caps = (...granted: string[]) => (...need: string[]) => need.every((c) => granted.includes(c));
const everything = caps("orders.read", "orders.fulfil", "orders.manage", "orders.refund");
const keys = (o: ActionableOrder, can = everything) => availableActions(o, can).map((a) => a.key);

describe("availableActions", () => {
  it("offers the forward step first and cancel last, for every state of a delivery order", () => {
    expect(keys(order("PENDING_PAYMENT", "DELIVERY"))).toEqual(["cancel"]);
    expect(keys(order("CONFIRMED", "DELIVERY"))).toEqual(["start-picking", "cancel"]);
    expect(keys(order("PICKING", "DELIVERY"))).toEqual(["finish-picking", "cancel"]);
    expect(keys(order("PACKING", "DELIVERY"))).toEqual(["finish-packing", "reopen-picking", "cancel"]);
    expect(keys(order("READY_FOR_DISPATCH", "DELIVERY"))).toEqual(["dispatch", "cancel"]);
    expect(keys(order("OUT_FOR_DELIVERY", "DELIVERY"))).toEqual(["complete", "cancel"]);
    for (const done of ["COMPLETED", "CANCELLED", "PAYMENT_FAILED"]) expect(keys(order(done, "DELIVERY"))).toEqual([]);
  });

  it("offers the pickup path for pickup orders and never a delivery-only step", () => {
    expect(keys(order("PACKING", "PICKUP"))).toEqual(["finish-packing", "reopen-picking", "cancel"]);
    expect(keys(order("READY_FOR_PICKUP", "PICKUP"))).toEqual(["complete", "cancel"]);
    const labels = availableActions(order("PACKING", "PICKUP"), everything).map((a) => a.label);
    expect(labels[0]).toBe("Packed — ready for pickup");
    expect(availableActions(order("PACKING", "DELIVERY"), everything)[0].label).toBe("Packed — ready for dispatch");
    expect(availableActions(order("READY_FOR_PICKUP", "PICKUP"), everything)[0].label).toBe("Hand over to customer");
    expect(availableActions(order("OUT_FOR_DELIVERY", "DELIVERY"), everything)[0].label).toBe("Mark delivered");
    // a pickup order can't be dispatched even if someone fed us odd data
    expect(keys({ status: "READY_FOR_DISPATCH", fulfilment_type: "PICKUP", allowed_transitions: [] })).toEqual([]);
  });

  it("only maps transitions that have an endpoint; payment-driven and 'back to dispatch' steps never become buttons", () => {
    for (const status of Object.keys(TRANSITIONS)) {
      for (const type of ["DELIVERY", "PICKUP"] as const) {
        const offered = keys(order(status, type));
        expect(offered.length).toBeLessThanOrEqual(3);
        expect(offered).not.toContain("confirm");
      }
    }
    expect(keys(order("OUT_FOR_DELIVERY", "DELIVERY"))).not.toContain("dispatch");
  });

  it("follows the API's allowed_transitions rather than guessing from the status", () => {
    expect(keys({ status: "CONFIRMED", fulfilment_type: "DELIVERY", allowed_transitions: [] })).toEqual([]);
    expect(keys({ status: "CONFIRMED", fulfilment_type: "DELIVERY", allowed_transitions: ["CANCELLED"] })).toEqual(["cancel"]);
  });

  it("hides what the role may not call (picker cannot cancel, support cannot pick)", () => {
    const picker = caps("orders.read", "orders.fulfil");
    const support = caps("orders.read", "orders.manage", "orders.refund");
    expect(keys(order("CONFIRMED", "DELIVERY"), picker)).toEqual(["start-picking"]);
    expect(keys(order("CONFIRMED", "DELIVERY"), support)).toEqual(["cancel"]);
    expect(keys(order("PICKING", "DELIVERY"), support)).toEqual(["cancel"]);
    expect(keys(order("CONFIRMED", "DELIVERY"), caps("orders.read"))).toEqual([]);
  });

  it("does not offer 'reopen picking' once the payment has been captured", () => {
    expect(keys(order("PACKING", "DELIVERY", { payments: [{ state: "AUTHORIZED" }] }))).toContain("reopen-picking");
    expect(keys(order("PACKING", "DELIVERY", { payments: [{ state: "CAPTURED" }] }))).not.toContain("reopen-picking");
  });

  it("asks for confirmation on everything except starting to pick, and marks cancel as the dangerous one", () => {
    const all = Object.keys(TRANSITIONS).flatMap((s) => availableActions(order(s, "DELIVERY"), everything));
    for (const a of all) expect(!!a.confirm || a.key === "start-picking" || a.key === "cancel").toBe(true);
    expect(all.find((a) => a.key === "cancel")?.variant).toBe("danger");
    expect(all.find((a) => a.key === "cancel")?.capability).toBe("orders.manage");
    expect(all.find((a) => a.key === "finish-packing")?.confirm?.description).toMatch(/captures the card payment/i);
  });

  it("points each action at the real endpoint", () => {
    const endpoints = Object.fromEntries(Object.keys(TRANSITIONS).flatMap((s) => availableActions(order(s, "DELIVERY"), everything)).map((a) => [a.key, a.endpoint]));
    expect(endpoints).toEqual({
      cancel: "cancel/", "start-picking": "start-picking/", "finish-picking": "finish-picking/", "finish-packing": "finish-packing/", "reopen-picking": "reopen-picking/", dispatch: "dispatch/", complete: "complete/",
    });
  });
});

describe("OPEN_STATUSES (the dashboard's ?open=1 preset)", () => {
  it("is every accepted status except completed", () => {
    expect([...OPEN_STATUSES]).toEqual(["CONFIRMED", "PICKING", "PACKING", "READY_FOR_PICKUP", "READY_FOR_DISPATCH", "OUT_FOR_DELIVERY"]);
  });
});

const item = (id: number, status: StaffItem["status"], extra: Partial<StaffItem> = {}) => ({ id, status, storage: "AMBIENT", category: "Pantry", ...extra }) as StaffItem;

describe("pickProgress", () => {
  it("counts picked and short lines as done and ignores removed/replaced/proposed ones in the total", () => {
    const p = pickProgress([item(1, "PICKED"), item(2, "SHORT"), item(3, "PENDING"), item(4, "REMOVED"), item(5, "SUBSTITUTED"), item(6, "PROPOSED"), item(7, "UNAVAILABLE")]);
    expect(p.total).toBe(4); // picked, short, pending, unavailable
    expect(p.done).toBe(2);
    expect(p.percent).toBe(50);
    expect(p.openIds).toEqual([3, 6, 7]);
    expect(p.todoIds).toEqual([3, 7]); // line 6 is a proposed replacement: it waits for the customer
    expect(p.awaitingCustomer).toBe(true);
    expect(p.anyDelivered).toBe(true);
  });
  it("treats an unavailable line with a pending proposal as waiting on the customer, not as work for the picker", () => {
    const p = pickProgress([item(1, "PICKED"), item(2, "UNAVAILABLE"), item(3, "PROPOSED", { substitute_for: 2 })]);
    expect(p.openIds).toEqual([2, 3]);
    expect(p.todoIds).toEqual([]);
    expect(p.awaitingCustomer).toBe(true);
    // without a proposal the same unavailable line is the picker's to resolve
    expect(pickProgress([item(2, "UNAVAILABLE")]).todoIds).toEqual([2]);
  });
  it("is complete when nothing is open and handles an empty order", () => {
    expect(pickProgress([item(1, "PICKED")])).toMatchObject({ percent: 100, openIds: [], awaitingCustomer: false });
    expect(pickProgress([])).toMatchObject({ total: 0, percent: 100, anyDelivered: false });
    expect(pickProgress([item(1, "REMOVED")]).anyDelivered).toBe(false);
  });
});

describe("effectivePolicy (mirrors fulfilment.effective_policy)", () => {
  it("lets a per-item choice override the order's", () => {
    expect(effectivePolicy("ALLOW", "INHERIT")).toBe("ALLOW");
    expect(effectivePolicy("CONTACT", "INHERIT")).toBe("CONTACT");
    expect(effectivePolicy("CONTACT", "NONE")).toBe("NONE");
    expect(effectivePolicy("ALLOW", "NONE")).toBe("NONE");
    expect(effectivePolicy("NONE", "ALLOW")).toBe("ALLOW");
    expect(effectivePolicy("CONTACT", "ALLOW")).toBe("CONTACT");
    expect(effectivePolicy("NONE", "INHERIT")).toBe("NONE");
  });
});

describe("groupByZone", () => {
  it("groups by storage zone (ambient, chilled, frozen) then category, keeping the API's order inside", () => {
    const zones = groupByZone([
      item(1, "PENDING", { storage: "FROZEN", category: "Ice cream" }),
      item(2, "PENDING", { storage: "AMBIENT", category: "Pasta" }),
      item(3, "PENDING", { storage: "AMBIENT", category: "Pasta" }),
      item(4, "PENDING", { storage: "CHILLED", category: "Dairy" }),
      item(5, "PENDING", { storage: "AMBIENT", category: "Tins" }),
    ]);
    expect(zones.map((z) => z.storage)).toEqual(["AMBIENT", "CHILLED", "FROZEN"]);
    expect(zones[0].categories.map((c) => [c.name, c.items.map((i) => i.id)])).toEqual([["Pasta", [2, 3]], ["Tins", [5]]]);
  });
});

describe("refunds", () => {
  const pay = (over: Record<string, unknown> = {}) => ({ state: "CAPTURED", captured: "20.00", refunded: "0.00", attempt: 1, ...over });

  it("works out what can still be refunded the way the server does", () => {
    expect(refundableAmount([pay()], [])).toBe("20.00");
    expect(refundableAmount([pay({ state: "PARTIALLY_REFUNDED", refunded: "5.50" })], [])).toBe("14.50");
    expect(refundableAmount([pay()], [{ status: "PENDING", amount: "2.50" }, { status: "SUCCEEDED", amount: "9.00" }, { status: "FAILED", amount: "1.00" }])).toBe("17.50");
    expect(refundableAmount([pay({ refunded: "20.00", state: "REFUNDED" })], [])).toBeNull(); // fully refunded: no collected payment left
    expect(refundableAmount([pay()], [{ status: "PENDING", amount: "25.00" }])).toBe("0.00");
  });

  it("is null when nothing has been collected and uses the newest collected attempt", () => {
    expect(refundableAmount([], [])).toBeNull();
    expect(refundableAmount([pay({ state: "AUTHORIZED" }), pay({ state: "FAILED" })], [])).toBeNull();
    expect(refundableAmount([pay({ attempt: 1, captured: "5.00" }), pay({ attempt: 2, captured: "8.00" })], [])).toBe("8.00");
  });

  it("totals captured and refunded money exactly", () => {
    expect(sumCaptured([{ captured: "10.10" }, { captured: "0.20" }])).toBe("10.30");
    expect(sumRefunded([{ status: "SUCCEEDED", amount: "1.10" }, { status: "SUCCEEDED", amount: "2.20" }, { status: "PENDING", amount: "5.00" }], "SUCCEEDED")).toBe("3.30");
    expect(sumRefunded([{ status: "PENDING", amount: "5.00" }], "PENDING")).toBe("5.00");
  });

  it("validates the amount a manager types", () => {
    expect(validateRefundAmount("", "20.00")).toMatch(/enter the amount/i);
    expect(validateRefundAmount("abc", "20.00")).toMatch(/like 12.50/);
    expect(validateRefundAmount("1.234", "20.00")).toMatch(/2 decimals/);
    expect(validateRefundAmount("0", "20.00")).toMatch(/greater than zero/);
    expect(validateRefundAmount("-3", "20.00")).toMatch(/greater than zero/);
    expect(validateRefundAmount("20.01", "20.00", (v) => `$${v}`)).toBe("At most $20.00 can still be refunded.");
    expect(validateRefundAmount("20", "20.00")).toBeNull();
    expect(validateRefundAmount("0.01", "20.00")).toBeNull();
    expect(validateRefundAmount("5", null)).toBeNull(); // the server decides when nothing is known
  });

  it("describes outcomes honestly: only SUCCEEDED means money moved", () => {
    expect(describeRefund({ status: "SUCCEEDED" }, "$5.00")).toMatchObject({ tone: "ok" });
    expect(describeRefund({ status: "FAILED", failure: "Card closed" }, "$5.00")).toMatchObject({ tone: "bad", body: "Card closed" });
    const manual = describeRefund({ status: "PENDING", method: "MANUAL" }, "$5.00");
    expect(manual.tone).toBe("warn");
    expect(manual.title).toMatch(/not paid out yet/i);
    const outage = describeRefund({ status: "PENDING", method: "PROVIDER", failure: "Provider unreachable: timeout" }, "$5.00");
    expect(outage.tone).toBe("warn");
    expect(outage.body).toMatch(/nothing has been paid back/i);
    expect(describeRefund({ status: "PENDING", method: "PROVIDER" }, "$5.00").tone).toBe("warn");
  });
});

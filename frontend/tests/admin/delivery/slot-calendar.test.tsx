import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlotCalendar } from "@/components/admin/delivery/slot-calendar";
import type { SlotRow } from "@/components/admin/delivery/slot-grid";
import { isoDate } from "@/lib/admin";
import { apiError, list, mockApi, renderAdmin } from "../purchasing/helpers";

afterEach(() => vi.unstubAllGlobals());

const today = isoDate(new Date());
const slot = (id: number, over: Partial<SlotRow> = {}): SlotRow => ({
  id, branch: 1, zone: 1, kind: "DELIVERY", date: today, start_time: "09:00:00", end_time: "11:00:00", capacity: 5, booked: 0, remaining: 5, fee: "3.00", is_open: true, ...over,
});
const zones = { json: [{ id: 1, branch: 1, name: "Inner", postcode_prefixes: ["RW3"], areas: [], delivery_fee: "3.00", free_delivery_threshold: null, min_order_value: "0.00", priority: 100, is_active: true }] };

describe("SlotCalendar", () => {
  it("lays slots out by time window with booked/capacity", async () => {
    mockApi({
      "GET /admin/slots/": { json: list([slot(1, { booked: 3 }), slot(2, { kind: "PICKUP", zone: null, start_time: "13:00:00", end_time: "14:00:00", capacity: 8, fee: "0.00" })]) },
      "GET /admin/zones/": zones,
    });
    renderAdmin(<SlotCalendar branchId={1} />);
    expect(await screen.findByText("3/5 booked · $3.00")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Inner: 3 of 5 booked" })).toBeInTheDocument();
    expect(screen.getByText("0/8 booked · no fee")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /^9\sAM\s–\s11\sAM$/ })).toBeInTheDocument();
  });

  it("closes an empty slot straight away", async () => {
    const api = mockApi({
      "GET /admin/slots/": { json: list([slot(1)]) },
      "GET /admin/zones/": zones,
      "PATCH /admin/slots/1/": { json: slot(1, { is_open: false }) },
    });
    const user = userEvent.setup();
    renderAdmin(<SlotCalendar branchId={1} />);
    await user.click(await screen.findByRole("button", { name: /^Close the Inner slot/ }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "PATCH /admin/slots/1/")).toBe(true));
    expect(api.calls.find((c) => c.key === "PATCH /admin/slots/1/")!.body).toEqual({ is_open: false });
    expect(screen.queryByText("This slot has bookings")).not.toBeInTheDocument();
  });

  it("warns before closing a slot that customers have booked, and only closes after confirmation", async () => {
    const api = mockApi({
      "GET /admin/slots/": { json: list([slot(1, { booked: 2 })]) },
      "GET /admin/zones/": zones,
      "PATCH /admin/slots/1/": { json: slot(1, { booked: 2, is_open: false }) },
    });
    const user = userEvent.setup();
    renderAdmin(<SlotCalendar branchId={1} />);
    await user.click(await screen.findByRole("button", { name: /^Close the Inner slot/ }));
    const dialog = await screen.findByRole("dialog", { name: "This slot has bookings" });
    expect(within(dialog).getByText(/2 customers have booked/)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not move or cancel their orders/)).toBeInTheDocument();
    expect(api.calls.some((c) => c.key.startsWith("PATCH"))).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Close it anyway" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "PATCH /admin/slots/1/")).toBe(true));
    expect(api.calls.find((c) => c.key === "PATCH /admin/slots/1/")!.body).toEqual({ is_open: false });
  });

  it("reopens a closed slot without any warning", async () => {
    const api = mockApi({
      "GET /admin/slots/": { json: list([slot(1, { booked: 2, is_open: false })]) },
      "GET /admin/zones/": zones,
      "PATCH /admin/slots/1/": { json: slot(1, { booked: 2 }) },
    });
    const user = userEvent.setup();
    renderAdmin(<SlotCalendar branchId={1} />);
    expect(await screen.findByText("Closed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Reopen the Inner slot/ }));
    await waitFor(() => expect(api.calls.find((c) => c.key === "PATCH /admin/slots/1/")?.body).toEqual({ is_open: true }));
  });

  it("shows the server's message when a change is refused", async () => {
    mockApi({
      "GET /admin/slots/": { json: list([slot(1)]) },
      "GET /admin/zones/": zones,
      "PATCH /admin/slots/1/": apiError(400, "VALIDATION_ERROR", "Something the server said."),
    });
    const user = userEvent.setup();
    renderAdmin(<SlotCalendar branchId={1} />);
    await user.click(await screen.findByRole("button", { name: /^Close the Inner slot/ }));
    expect(await screen.findByText("Something the server said.")).toBeInTheDocument();
  });

  it("explains an empty week honestly", async () => {
    mockApi({ "GET /admin/slots/": { json: list([]) }, "GET /admin/zones/": zones });
    renderAdmin(<SlotCalendar branchId={1} />);
    expect(await screen.findByText("No slots this week")).toBeInTheDocument();
  });

  it("hides the controls from staff who can't manage slots", async () => {
    mockApi({ "GET /admin/slots/": { json: list([slot(1)]) }, "GET /admin/zones/": zones });
    renderAdmin(<SlotCalendar branchId={1} />, ["catalog.read"]);
    await screen.findByText("0/5 booked · $3.00");
    expect(screen.queryByRole("button", { name: /^Close the/ })).not.toBeInTheDocument();
  });
});

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoursClosuresTab } from "@/components/admin/delivery/hours-closures-tab";
import type { Branch } from "@/components/admin/delivery/types";
import { apiError, mockApi, renderAdmin } from "../purchasing/helpers";

afterEach(() => vi.unstubAllGlobals());

const branch = (over: Partial<Branch> = {}): Branch => ({
  id: 1, code: "main", name: "Main store", slug: "main", address_line1: "1 High St", address_line2: "", city: "Riverton", area: "", postal_code: "", phone: "", email: "", timezone: "",
  is_active: true, is_default: true, offers_delivery: true, offers_pickup: true, prep_minutes: 120, pickup_instructions: "", is_demo: false,
  hours: [...Array(6)].map((_, d) => ({ weekday: d, opens: "08:00:00", closes: "20:00:00", is_closed: false })).concat([{ weekday: 6, opens: null as any, closes: null as any, is_closed: true }]), ...over,
});

describe("HoursClosuresTab", () => {
  it("shows seven rows, saves nothing until valid, then sends the whole week", async () => {
    const api = mockApi({ "GET /admin/branches/": { json: [branch()] }, "GET /admin/closures/": { json: [] }, "PATCH /admin/branches/1/": { json: branch() } });
    const user = userEvent.setup();
    renderAdmin(<HoursClosuresTab />);
    const mondayOpens = (await screen.findAllByLabelText("Opens"))[0];
    expect(screen.getAllByLabelText("Opens")).toHaveLength(6); // Sunday is closed
    expect(screen.getByText("Closed all day")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save hours" })).toBeDisabled(); // nothing changed yet

    fireEvent.change(mondayOpens, { target: { value: "21:00" } });
    await user.click(screen.getByRole("button", { name: "Save hours" }));
    expect(await screen.findByText("Opening time must be before closing time.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key.startsWith("PATCH"))).toHaveLength(0);

    fireEvent.change(mondayOpens, { target: { value: "07:30" } });
    await user.click(screen.getByRole("button", { name: "Save hours" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "PATCH /admin/branches/1/")).toBe(true));
    const body = api.calls.find((c) => c.key === "PATCH /admin/branches/1/")!.body;
    expect(body.hours).toHaveLength(7);
    expect(body.hours[0]).toEqual({ weekday: 0, opens: "07:30", closes: "20:00", is_closed: false });
    expect(body.hours[6]).toEqual({ weekday: 6, opens: null, closes: null, is_closed: true });
  });

  it("requires times on a day that is being opened", async () => {
    const api = mockApi({ "GET /admin/branches/": { json: [branch()] }, "GET /admin/closures/": { json: [] } });
    const user = userEvent.setup();
    renderAdmin(<HoursClosuresTab />);
    await screen.findAllByLabelText("Opens");
    await user.click(screen.getAllByRole("checkbox", { name: "Closed" })[6]); // open Sunday with no times
    await user.click(screen.getByRole("button", { name: "Save hours" }));
    expect(await screen.findByText("Set an opening time.")).toBeInTheDocument();
    expect(screen.getByText("Set a closing time.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key.startsWith("PATCH"))).toHaveLength(0);
  });

  it("warns when a store has no open days at all", async () => {
    mockApi({ "GET /admin/branches/": { json: [branch({ hours: [] })] }, "GET /admin/closures/": { json: [] } });
    renderAdmin(<HoursClosuresTab />);
    expect(await screen.findByText("No opening hours are saved for this store")).toBeInTheDocument();
  });

  it("is read-only without branches.manage", async () => {
    mockApi({ "GET /admin/branches/": { json: [branch()] }, "GET /admin/closures/": { json: [] } });
    renderAdmin(<HoursClosuresTab />, ["slots.manage", "catalog.read"]);
    const first = (await screen.findAllByLabelText("Opens"))[0];
    expect(first).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save hours" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add closure" })).toBeInTheDocument(); // closures need slots.manage instead
  });

  it("shows the API's refusal verbatim when a closure clashes with booked slots", async () => {
    const message = "Customers have already booked slots that day. Move or cancel those orders before closing the branch.";
    const api = mockApi({ "GET /admin/branches/": { json: [branch()] }, "GET /admin/closures/": { json: [] }, "POST /admin/closures/": apiError(409, "INVALID_STATE", message) });
    const user = userEvent.setup();
    renderAdmin(<HoursClosuresTab />);
    await user.click(await screen.findByRole("button", { name: "Add closure" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/First day/), { target: { value: "2030-12-25" } });
    await user.click(within(dialog).getByRole("button", { name: "Add closure" }));
    expect(await within(dialog).findByText(message)).toBeInTheDocument();
    expect(api.calls.find((c) => c.key === "POST /admin/closures/")!.body).toEqual({ branch: 1, date: "2030-12-25", reason: "" });
  });

  it("closes a run of days one request each and says how far it got if one is refused", async () => {
    let n = 0;
    const api = mockApi({
      "GET /admin/branches/": { json: [branch()] },
      "GET /admin/closures/": { json: [] },
      "POST /admin/closures/": () => (++n < 3 ? { json: { id: n } } : apiError(409, "INVALID_STATE", "Customers have already booked slots that day.")),
    });
    const user = userEvent.setup();
    renderAdmin(<HoursClosuresTab />);
    await user.click(await screen.findByRole("button", { name: "Add closure" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/First day/), { target: { value: "2030-12-24" } });
    fireEvent.change(within(dialog).getByLabelText(/Last day/), { target: { value: "2030-12-27" } });
    await user.click(within(dialog).getByRole("button", { name: "Close 4 days" }));
    expect(await within(dialog).findByText(/Dec 26: Customers have already booked slots that day\. 2 earlier days were closed\./)).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key === "POST /admin/closures/").map((c) => c.body.date)).toEqual(["2030-12-24", "2030-12-25", "2030-12-26"]); // stopped at the refusal
  });

  it("refuses an over-long or backwards range before sending anything", async () => {
    const api = mockApi({ "GET /admin/branches/": { json: [branch()] }, "GET /admin/closures/": { json: [] } });
    const user = userEvent.setup();
    renderAdmin(<HoursClosuresTab />);
    await user.click(await screen.findByRole("button", { name: "Add closure" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/First day/), { target: { value: "2030-12-24" } });
    fireEvent.change(within(dialog).getByLabelText(/Last day/), { target: { value: "2030-12-20" } });
    await user.click(within(dialog).getByRole("button", { name: "Add closure" }));
    expect(await within(dialog).findByText("The last day is before the first day.")).toBeInTheDocument();
    expect(api.calls.filter((c) => c.key.startsWith("POST"))).toHaveLength(0);
  });
});

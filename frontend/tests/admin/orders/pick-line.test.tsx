import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PickLine, type LineHandlers } from "@/components/admin/orders/pick-line";
import { ApiError } from "@/lib/api";
import { MANAGER_CAPS, PICKER_CAPS, item, order, renderAdmin } from "./helpers";

afterEach(cleanup);

const handlers: LineHandlers = { onUnavailable: vi.fn(), onSubstitute: vi.fn(), onRemove: vi.fn(), onDecide: vi.fn() };

function line(over: Parameters<typeof item>[0] = {}, caps = PICKER_CAPS, call = vi.fn(async () => order())) {
  const it = item(over);
  const o = order({ status: "PICKING", items: [it] });
  const onActed = vi.fn();
  renderAdmin(<ul><PickLine order={o} item={it} call={call as never} flagged={false} onActed={onActed} {...handlers} /></ul>, caps);
  return { call, onActed, user: userEvent.setup() };
}
const confirm = () => screen.getByRole("button", { name: /^(Enter|Confirm|Pick|Picked)/ });

describe("PickLine: weighed item", () => {
  it("states the accepted window and waits for a weight from the scale", () => {
    line();
    expect(screen.getByText(/1\.35–1\.65 kg/)).toBeInTheDocument();
    expect(screen.getByLabelText(/weight on the scale/i)).toHaveValue("");
    expect(confirm()).toBeDisabled();
    expect(confirm()).toHaveTextContent("Enter the weight");
  });

  it("shows the live price impact from exact decimals while typing", async () => {
    const { user } = line();
    await user.type(screen.getByLabelText(/weight on the scale/i), "1.62");
    expect(await screen.findByText(/customer pays about/i)).toHaveTextContent("$19.44");
    expect(screen.getByText(/customer pays about/i)).toHaveTextContent("+$1.44");
    expect(confirm()).toBeEnabled();
    expect(confirm()).toHaveTextContent("Confirm 1.62 kg");
  });

  it("explains a too-heavy weight and blocks a picker from submitting it", async () => {
    const { user, call } = line();
    await user.type(screen.getByLabelText(/weight on the scale/i), "1.9");
    expect(await screen.findByText(/heavier than the 1\.65 kg allowed/i)).toBeInTheDocument();
    expect(screen.getByText(/ask a manager to override/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    expect(call).not.toHaveBeenCalled();
  });

  it("lets a manager override, charging only up to the window maximum", async () => {
    const { user, call, onActed } = line({}, MANAGER_CAPS);
    await user.type(screen.getByLabelText(/weight on the scale/i), "1.9");
    expect(confirm()).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /manager override/i }));
    expect(screen.getByText(/customer pays about/i)).toHaveTextContent("$19.80"); // 1.65 kg x 12.00
    expect(confirm()).toBeEnabled();
    await user.click(confirm());
    await waitFor(() => expect(call).toHaveBeenCalledWith("items/11/pick/", { picked_qty: "1.9", note: "", override: true }));
    expect(onActed).toHaveBeenCalledWith(11);
  });

  it("marks a light weight as short and still lets the picker confirm", async () => {
    const { user, call } = line();
    await user.type(screen.getByLabelText(/weight on the scale/i), "1.2");
    expect(await screen.findByText(/lighter than 1\.35 kg: recorded as short-picked/i)).toBeInTheDocument();
    await user.click(confirm());
    await waitFor(() => expect(call).toHaveBeenCalledWith("items/11/pick/", { picked_qty: "1.2", note: "", override: false }));
  });

  it("shows the server's verdict right under the line, not just in a toast", async () => {
    const call = vi.fn(async () => { throw new ApiError(422, "WEIGHT_OUT_OF_TOLERANCE", "1.6 kg is more than the 10% allowed over the 1.5 kg ordered (max 1.65). Pick a smaller piece, or ask a manager to override.", { max_allowed: "1.65" }); });
    const { user, onActed } = line({}, PICKER_CAPS, call as never);
    await user.type(screen.getByLabelText(/weight on the scale/i), "1.6");
    await user.click(confirm());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/more than the 10% allowed/);
    expect(onActed).not.toHaveBeenCalled();
    expect(confirm()).toBeEnabled(); // can correct and try again
  });

  it("sends the picker's note", async () => {
    const { user, call } = line();
    await user.type(screen.getByLabelText(/weight on the scale/i), "1.5");
    await user.click(screen.getByRole("button", { name: /add a note/i }));
    await user.type(screen.getByLabelText(/note/i), "smaller block");
    await user.click(confirm());
    await waitFor(() => expect(call).toHaveBeenCalledWith("items/11/pick/", { picked_qty: "1.5", note: "smaller block", override: false }));
  });
});

describe("PickLine: counted item", () => {
  const counted = { is_variable_weight: false, tolerance: null, unit: "each", ordered_qty: "4", unit_price: "3.50", line_total_estimated: "14.00", name: "Whole milk" };

  it("starts at the ordered quantity so a full pick is one tap", async () => {
    const { user, call } = line(counted);
    expect(screen.getByLabelText(/quantity picked/i)).toHaveValue("4");
    expect(confirm()).toHaveTextContent("Picked 4 each");
    await user.click(confirm());
    await waitFor(() => expect(call).toHaveBeenCalledWith("items/11/pick/", { picked_qty: "4", note: "", override: false }));
  });

  it("steps down for a short pick and says so, with the exact price effect", async () => {
    const { user, call } = line(counted);
    await user.click(screen.getByRole("button", { name: /decrease whole milk/i }));
    expect(screen.getByLabelText(/quantity picked/i)).toHaveValue("3");
    expect(screen.getByText(/short by 1 each/i)).toBeInTheDocument();
    expect(screen.getByText(/customer pays about/i)).toHaveTextContent("$10.50");
    await user.click(confirm());
    await waitFor(() => expect(call).toHaveBeenCalledWith("items/11/pick/", { picked_qty: "3", note: "", override: false }));
  });

  it("cannot be stepped or typed above what was ordered", async () => {
    const { user } = line(counted);
    await user.click(screen.getByRole("button", { name: /increase whole milk/i }));
    expect(screen.getByLabelText(/quantity picked/i)).toHaveValue("4");
    await user.clear(screen.getByLabelText(/quantity picked/i));
    await user.type(screen.getByLabelText(/quantity picked/i), "5");
    expect(await screen.findByText(/you can't pick more/i)).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
  });

  it("sends zero nowhere: 'Can't find it' is the way to say nothing was found", async () => {
    const { user, call } = line(counted);
    await user.clear(screen.getByLabelText(/quantity picked/i));
    await user.type(screen.getByLabelText(/quantity picked/i), "0");
    expect(await screen.findByText(/use “can't find it”/i)).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /can't find it/i }));
    expect(handlers.onUnavailable).toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });
});

describe("PickLine: other states", () => {
  it("offers a replacement only when the customer's choice allows one", () => {
    const pending = order({ status: "PICKING", substitution_policy: "ALLOW" });
    const unavailable = item({ status: "UNAVAILABLE", picker_note: "shelf empty" });
    const { unmount } = renderAdmin(<ul><PickLine order={{ ...pending, items: [unavailable] }} item={unavailable} call={vi.fn() as never} flagged={false} onActed={vi.fn()} {...handlers} /></ul>, PICKER_CAPS);
    expect(screen.getByRole("button", { name: /find a replacement/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove line/i })).toBeInTheDocument();
    unmount();
    const never = item({ status: "UNAVAILABLE", substitution_pref: "NONE" });
    renderAdmin(<ul><PickLine order={{ ...pending, items: [never] }} item={never} call={vi.fn() as never} flagged={false} onActed={vi.fn()} {...handlers} /></ul>, PICKER_CAPS);
    expect(screen.queryByRole("button", { name: /find a replacement/i })).not.toBeInTheDocument();
  });

  it("shows picked lines as done with their result, and flags a line the server objected to", () => {
    const done = item({ status: "SHORT", picked_qty: "1.2", line_total_final: "14.40", picker_note: "small block" });
    renderAdmin(<ul><PickLine order={order({ status: "PICKING", items: [done] })} item={done} call={vi.fn() as never} flagged={false} onActed={vi.fn()} {...handlers} /></ul>, PICKER_CAPS);
    expect(screen.getByText(/picked 1\.2 kg of 1\.5 kg/i)).toBeInTheDocument();
    expect(screen.getByText("Short-picked")).toBeInTheDocument();
    expect(screen.getByText("$14.40")).toBeInTheDocument();
    cleanup();
    const open = item();
    renderAdmin(<ul><PickLine order={order({ status: "PICKING", items: [open] })} item={open} call={vi.fn() as never} flagged onActed={vi.fn()} {...handlers} /></ul>, PICKER_CAPS);
    expect(screen.getByText(/still to do — finish this line/i)).toBeInTheDocument();
  });
});

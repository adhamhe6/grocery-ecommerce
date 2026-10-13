import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BatchesPage } from "@/components/admin/inventory/batches-page";
import type { BatchRow } from "@/components/admin/inventory/types";
import { apiError, list, mockApi, renderAdmin } from "../purchasing/helpers";

afterEach(() => vi.unstubAllGlobals());

const batch = (id: number, over: Partial<BatchRow> = {}): BatchRow => ({
  id, product_id: 6, sku: "YOG", name: "Yoghurt 500g", unit: "ea", branch: "Main store", branch_id: 1, lot_code: `LOT-${id}`, supplier: "Millbrook Dairy", received_on: "2026-10-01", expiry_date: "2026-10-20",
  expiry_kind: "USE_BY", sellable_until: "2026-10-19", days_to_expiry: 8, qty_received: "10", qty_remaining: "10", qty_reserved: "0", unit_cost: "1.1000", value: "11.00", status: "ACTIVE",
  quality_status: "PASSED", is_demo: false, risk: "OK", can_sell: true, ...over,
});
const expired = batch(1, { lot_code: "OLD", days_to_expiry: -2, status: "EXPIRED", expiry_date: "2026-10-10", risk: "EXPIRED", can_sell: false });
const soon = batch(2, { lot_code: "SOON", days_to_expiry: 1, risk: "TODAY_TOMORROW", qty_remaining: "6" });
const expiry = {
  today: "2026-10-12",
  groups: { expired: [expired], today_tomorrow: [soon], within_3: [], within_7: [] },
  totals: { expired: { batches: 1, value: "11.00" }, today_tomorrow: { batches: 1, value: "6.60" }, within_3: { batches: 0, value: "0.00" }, within_7: { batches: 0, value: "0.00" } },
  waste_reasons: [],
};
const routes = {
  "GET /admin/inventory/expiry/": { json: expiry },
  "GET /admin/inventory/batches/": { json: list([expired, soon, batch(3, { lot_code: "FINE" })]) },
};

describe("BatchesPage", () => {
  it("buckets the expiry board and explains that expired stock stays on hand", async () => {
    mockApi(routes);
    renderAdmin(<BatchesPage />);
    expect(await screen.findByText("Expired batches stay on hand until you write them off")).toBeInTheDocument();
    const board = screen.getByRole("region", { name: "Expiry board" });
    await waitFor(() => expect(board).toHaveTextContent("Expired 2 days ago"));
    for (const t of ["Expired, still on hand", "Expires today or tomorrow", "Expires in 2–3 days", "Expires in 4–7 days"]) expect(board).toHaveTextContent(t);
    expect(board).toHaveTextContent("Expired 2 days ago");
    expect(board).toHaveTextContent("Expires tomorrow");
    expect(board).toHaveTextContent("1 batch");
  });

  it("lists each batch with lot, expiry kind, quality and status", async () => {
    mockApi(routes);
    renderAdmin(<BatchesPage />);
    const table = await screen.findByRole("table", { name: /Batches, soonest expiry first/ });
    expect(await screen.findByText("FINE")).toBeInTheDocument();
    expect(table).toHaveTextContent("Use by");
    expect(table).toHaveTextContent("Millbrook Dairy");
    expect(table).toHaveTextContent("Passed");
    expect(table).toHaveTextContent("Expired");
  });

  it("quarantines a batch after confirmation, with the note", async () => {
    const api = mockApi({ ...routes, "POST /admin/inventory/batches/2/status/": { json: batch(2, { status: "QUARANTINED", can_sell: false }) } });
    const user = userEvent.setup();
    renderAdmin(<BatchesPage />);
    const [menu] = await screen.findAllByRole("button", { name: "Actions for lot SOON of Yoghurt 500g" });
    await user.click(menu);
    await user.click(await screen.findByRole("menuitem", { name: "Quarantine…" }));
    await user.type(screen.getByLabelText(/Note/), "supplier recall");
    await user.click(screen.getByRole("button", { name: "Quarantine" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /admin/inventory/batches/2/status/")).toBe(true));
    expect(api.calls.find((c) => c.key === "POST /admin/inventory/batches/2/status/")!.body).toEqual({ status: "QUARANTINED", note: "supplier recall" });
  });

  it("offers 'write off as waste' only for expired batches and opens the waste dialog prefilled", async () => {
    mockApi({ ...routes });
    const user = userEvent.setup();
    renderAdmin(<BatchesPage />);
    const [soonMenu] = await screen.findAllByRole("button", { name: "Actions for lot SOON of Yoghurt 500g" });
    await user.click(soonMenu);
    expect(screen.queryByRole("menuitem", { name: /Write off as waste/ })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    const [oldMenu] = await screen.findAllByRole("button", { name: "Actions for lot OLD of Yoghurt 500g" });
    await user.click(oldMenu);
    await user.click(await screen.findByRole("menuitem", { name: /Write off as waste/ }));
    expect(await screen.findByRole("dialog", { name: "Record waste" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Reason/)).toHaveValue("EXPIRED");
    expect(screen.getByLabelText(/^Quantity/)).toHaveValue("10");
  });

  it("shows the server's refusal verbatim", async () => {
    mockApi({ ...routes, "POST /admin/inventory/batches/2/status/": apiError(409, "INVALID_STATE", "Expired or used-up batches can't be put back on sale.") });
    const user = userEvent.setup();
    renderAdmin(<BatchesPage />);
    const [menu] = await screen.findAllByRole("button", { name: "Actions for lot SOON of Yoghurt 500g" });
    await user.click(menu);
    await user.click(await screen.findByRole("menuitem", { name: "Fail quality check…" }));
    await user.click(screen.getByRole("button", { name: "Mark as failed" }));
    expect(await screen.findByText("Expired or used-up batches can't be put back on sale.")).toBeInTheDocument();
  });

  it("hides status actions from staff without inventory.batches", async () => {
    mockApi(routes);
    const user = userEvent.setup();
    renderAdmin(<BatchesPage />, ["inventory.read", "inventory.waste"]);
    const [menu] = await screen.findAllByRole("button", { name: "Actions for lot SOON of Yoghurt 500g" }).catch(() => [] as HTMLElement[]);
    expect(menu).toBeUndefined(); // nothing to do on an in-date batch, so no menu at all
    const [oldMenu] = await screen.findAllByRole("button", { name: "Actions for lot OLD of Yoghurt 500g" });
    await user.click(oldMenu);
    expect(screen.queryByRole("menuitem", { name: /Quarantine/ })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Write off as waste/ })).toBeInTheDocument();
  });
});

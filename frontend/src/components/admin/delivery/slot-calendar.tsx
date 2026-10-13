"use client";

import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import * as React from "react";
import { FormDialog, ToneBadge, useAdminAllPages, useFormAction } from "@/components/admin/inventory/form-kit";
import { ConfirmDialog, FilterSelect } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Field, Input } from "@/components/ui/field";
import { adminRequest, isoDate, useAdmin, useAdminList } from "@/lib/admin";
import { cn } from "@/lib/cn";
import { formatDate, formatTimeRange } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { validateMoney, validateWholeNumber } from "./forms";
import { addDays } from "./hours";
import { bookedPercent, buildGrid, cellKey, fillLevel, needsCloseWarning, type SlotRow } from "./slot-grid";
import type { Zone } from "./types";

const DAYS = 7;
const BAR: Record<string, string> = { empty: "bg-primary", some: "bg-primary", nearly: "bg-warn", full: "bg-bad" };

export function SlotCalendar({ branchId }: { branchId: number | null }) {
  const { can } = useAdmin();
  const canManage = can("slots.manage");
  const money = useMoney();
  const today = isoDate(new Date());
  const [from, setFrom] = React.useState(today);
  const [kind, setKind] = React.useState("");
  const [editing, setEditing] = React.useState<SlotRow | null>(null);
  const [closing, setClosing] = React.useState<SlotRow | null>(null);
  const to = addDays(from, DAYS - 1);

  const slots = useAdminAllPages<SlotRow>("/slots/", { branch: branchId ?? undefined, date_from: from, date_to: to, kind: kind || undefined }, { enabled: !!branchId, maxPages: 10 });
  const zones = useAdminList<Zone>("/zones/");
  const zoneName = React.useCallback((id: number | null) => zones.rows.find((z) => z.id === id)?.name ?? (id ? `Zone ${id}` : ""), [zones.rows]);
  const grid = React.useMemo(() => buildGrid(slots.rows, from, DAYS, zoneName), [slots.rows, from, zoneName]);

  const toggle = useFormAction((v: { slot: SlotRow; open: boolean }) => adminRequest<SlotRow>("PATCH", `/slots/${v.slot.id}/`, { is_open: v.open }), {
    invalidate: ["/slots"], success: (d) => (d.is_open ? "Slot reopened." : "Slot closed."), onSuccess: () => setClosing(null), onError: () => setClosing(null),
  });
  const pendingId = toggle.mutation.isPending ? toggle.mutation.variables?.slot.id : undefined;
  const requestToggle = (s: SlotRow) => {
    toggle.clear();
    if (needsCloseWarning(s)) setClosing(s);
    else toggle.mutation.mutate({ slot: s, open: !s.is_open });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setFrom(addDays(from, -DAYS))}><ChevronLeft className="size-4" aria-hidden /> Previous week</Button>
          <Button variant="secondary" size="sm" disabled={from === today} onClick={() => setFrom(today)}>Today</Button>
          <Button variant="secondary" size="sm" onClick={() => setFrom(addDays(from, DAYS))}>Next week <ChevronRight className="size-4" aria-hidden /></Button>
          <p className="ml-1 text-sm font-semibold text-ink" aria-live="polite">{formatDate(from, "en-US", { day: "numeric", month: "short" })} to {formatDate(to, "en-US", { day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
        <FilterSelect label="Show" value={kind} onChange={setKind} allLabel="Delivery and pickup" options={[["DELIVERY", "Delivery only"], ["PICKUP", "Pickup only"]]} />
      </div>
      <p className="text-sm text-ink-3">Each box is one bookable slot. The bar shows how much of its capacity is booked. Closing a slot stops new bookings; customers who already booked keep their slot.</p>
      {slots.truncated && <Alert tone="warn" title="Showing the first 1,000 slots">This week has more slots than can be shown at once. Narrow it with the Show filter.</Alert>}
      {toggle.message && <Alert tone="bad" title="The slot wasn’t changed">{toggle.message}</Alert>}

      {!branchId ? <EmptyState title="Choose a store">Slots are shown one store at a time.</EmptyState>
        : slots.error ? <ErrorState error={slots.error} onRetry={() => slots.refetch()} title="We couldn't load the slots" />
        : slots.isLoading ? <Skeleton className="h-80 w-full" />
        : !grid.rows.length ? <div className="rounded-lg border border-line bg-white shadow-sm"><EmptyState title="No slots this week">Slots appear here once you generate them from your templates. Use Generate slots at the top of the page.</EmptyState></div>
        : (
          <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm">
            <table className="w-full min-w-[64rem] table-fixed border-collapse text-left text-sm">
              <caption className="sr-only">Generated slots from {from} to {to}, one column per day and one row per time window</caption>
              <thead className="bg-paper-2/60 text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 w-28 border-b border-r border-line bg-paper-2 px-3 py-3 font-semibold">Time</th>
                  {grid.days.map((d) => (
                    <th key={d} scope="col" className={cn("border-b border-line px-3 py-3 font-semibold", d === today && "bg-primary-soft text-primary")}>
                      {formatDate(d)}{d === today && <span className="ml-1 normal-case">(today)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.key} className="align-top">
                    <th scope="row" className="sticky left-0 z-10 border-b border-r border-line bg-white px-3 py-3 text-left text-xs font-semibold text-ink">{formatTimeRange(r.start, r.end)}</th>
                    {grid.days.map((d) => {
                      const cell = grid.cells.get(cellKey(d, r.key)) ?? [];
                      return (
                        <td key={d} className={cn("border-b border-line p-1.5", d === today && "bg-primary-soft/40")}>
                          {!cell.length ? <span className="block px-1 py-2 text-xs text-ink-3" aria-label="No slot">—</span> : (
                            <ul className="space-y-1.5">
                              {cell.map((s) => {
                                const fill = fillLevel(s);
                                const name = s.kind === "DELIVERY" ? zoneName(s.zone) || "Delivery" : "Pickup";
                                return (
                                  <li key={s.id} className={cn("rounded-md border p-2 text-xs", s.is_open ? "border-line-strong bg-white" : "border-line bg-paper-2 text-ink-3")}>
                                    <div className="flex items-start justify-between gap-1">
                                      <p className={cn("font-semibold", s.is_open ? "text-ink" : "text-ink-2")}>{name}{s.kind === "DELIVERY" && <span className="font-normal text-ink-3"> · delivery</span>}</p>
                                      {!s.is_open ? <ToneBadge tone="neutral" icon={Lock}>Closed</ToneBadge> : fill === "full" ? <ToneBadge tone="bad">Full</ToneBadge> : null}
                                    </div>
                                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2" role="img" aria-label={`${name}: ${s.booked} of ${s.capacity} booked`}>
                                      <div className={cn("h-full rounded-full", BAR[fill])} style={{ width: `${bookedPercent(s)}%` }} />
                                    </div>
                                    <p className="num mt-1 text-ink-2">{s.booked}/{s.capacity} booked · {Number(s.fee) > 0 ? money(s.fee) : "no fee"}</p>
                                    {canManage && (
                                      <div className="mt-1.5 flex flex-wrap gap-1">
                                        <Button variant="secondary" size="sm" className="h-8 px-2 text-xs" loading={pendingId === s.id} aria-label={`${s.is_open ? "Close" : "Reopen"} the ${name} slot at ${formatTimeRange(s.start_time, s.end_time)} on ${formatDate(s.date)}`} onClick={() => requestToggle(s)}>{s.is_open ? "Close" : "Reopen"}</Button>
                                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-label={`Edit the ${name} slot at ${formatTimeRange(s.start_time, s.end_time)} on ${formatDate(s.date)}`} onClick={() => setEditing(s)}>Edit</Button>
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      {editing && <EditSlotDialog slot={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)} danger title="This slot has bookings" confirmLabel="Close it anyway" loading={toggle.mutation.isPending}
        description={closing ? `${closing.booked} ${closing.booked === 1 ? "customer has" : "customers have"} booked the ${formatTimeRange(closing.start_time, closing.end_time)} slot on ${formatDate(closing.date)}. Closing it stops new bookings but does not move or cancel their orders. You will need to contact those customers or reschedule the orders yourself.` : undefined}
        onConfirm={() => closing && toggle.mutation.mutate({ slot: closing, open: false })} />
    </div>
  );
}

function EditSlotDialog({ slot, onClose }: { slot: SlotRow; onClose: () => void }) {
  const [capacity, setCapacity] = React.useState(String(slot.capacity));
  const [fee, setFee] = React.useState(slot.fee);
  const [touched, setTouched] = React.useState(false);
  const { mutation, message, fieldErrors, clear } = useFormAction((body: { capacity: number; fee: string }) => adminRequest<SlotRow>("PATCH", `/slots/${slot.id}/`, body), { invalidate: ["/slots"], success: "Slot updated.", onSuccess: onClose });
  const errors = { capacity: validateWholeNumber(capacity, { min: 1, label: "capacity" }) ?? undefined, fee: validateMoney(fee, { required: true }) ?? undefined };
  const submit = () => {
    setTouched(true);
    if (errors.capacity || errors.fee) return;
    mutation.mutate({ capacity: Number(capacity), fee: fee.trim() });
  };
  return (
    <FormDialog onClose={onClose} onEdit={clear} title="Edit this slot" description={`${formatDate(slot.date, "en-US", { weekday: "long", day: "numeric", month: "long" })}, ${formatTimeRange(slot.start_time, slot.end_time)}. This changes only this one slot, not the template it came from.`} submitLabel="Save slot" onSubmit={submit} loading={mutation.isPending} message={message}>
      <Field label="Capacity" htmlFor="slot-cap" required error={fieldErrors.capacity ?? (touched ? errors.capacity : undefined)} hint={slot.booked > 0 ? `${slot.booked} already booked, so it can’t go lower than that.` : undefined}>
        <Input id="slot-cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
      </Field>
      <Field label="Fee" htmlFor="slot-fee" required error={fieldErrors.fee ?? (touched ? errors.fee : undefined)}>
        <Input id="slot-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

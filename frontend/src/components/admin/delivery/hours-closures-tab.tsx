"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { FormDialog, STICKY_ACTIONS, StoreSelect, ToneBadge, useFormAction, useWorkingBranch } from "@/components/admin/inventory/form-kit";
import { Card, ConfirmDialog, DataTable, type Column } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError } from "@/lib/api";
import { adminRequest, isoDate, useAdmin, useAdminList } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { MAX_CLOSURE_DAYS, WEEKDAY_NAMES, allClosed, closureRangeError, copyDay, expandDates, hoursFromApi, hoursPayload, sameHours, validateHours, type HourRow } from "./hours";
import type { Branch, Closure } from "./types";

export function HoursClosuresTab() {
  const [branchId, setBranchId] = useWorkingBranch();
  const branches = useAdminList<Branch>("/branches/");
  const branch = branches.rows.find((b) => b.id === branchId);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-2">Slots are only generated inside a store’s opening hours and never on a closure date. Choose a store to see and change its week.</p>
        <StoreSelect id="hours-store" value={branchId} onChange={setBranchId} />
      </div>
      {branches.error ? <ErrorState error={branches.error} onRetry={() => branches.refetch()} />
        : branches.isLoading ? <Skeleton className="h-72 w-full" />
        : !branch ? <EmptyState title="Choose a store">There is no store to show.</EmptyState>
        : (
          <>
            <HoursEditor key={branch.id} branch={branch} />
            <ClosuresPanel branch={branch} />
          </>
        )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ weekly hours
function HoursEditor({ branch }: { branch: Branch }) {
  const { can } = useAdmin();
  const canEdit = can("branches.manage");
  const saved = React.useMemo(() => hoursFromApi(branch.hours), [branch.hours]);
  const [rows, setRows] = React.useState<HourRow[]>(saved);
  const [touched, setTouched] = React.useState(false);
  const errors = validateHours(rows);
  const dirty = !sameHours(rows, saved);

  const save = useFormAction(
    (hours: ReturnType<typeof hoursPayload>) => adminRequest<Branch>("PATCH", `/branches/${branch.id}/`, { hours }),
    { invalidate: ["/branches"], success: `Opening hours saved for ${branch.name}.`, onSuccess: () => setTouched(false) },
  );
  const set = (weekday: number, p: Partial<HourRow>) => { save.clear(); setRows((rs) => rs.map((r) => (r.weekday === weekday ? { ...r, ...p } : r))); };
  const onSave = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    save.mutation.mutate(hoursPayload(rows));
  };

  return (
    <Card title={`Weekly opening hours · ${branch.name}`} actions={canEdit ? (
      <>
        <Button variant="secondary" size="sm" disabled={!dirty || save.mutation.isPending} onClick={() => { setRows(saved); setTouched(false); save.clear(); }}>Reset</Button>
        <Button size="sm" loading={save.mutation.isPending} disabled={!dirty} onClick={onSave}>Save hours</Button>
      </>
    ) : undefined}>
      <div className="space-y-4">
        {allClosed(saved) && <Alert tone="warn" title="No opening hours are saved for this store">A store with no open days can’t have delivery or pickup slots generated. Set the days it is open and save.</Alert>}
        {!canEdit && <p className="text-sm text-ink-3">Your role can view opening hours but not change them.</p>}
        <ul className="divide-y divide-line rounded-md border border-line">
          {rows.map((r) => {
            const e = touched ? errors[r.weekday] : undefined;
            const day = WEEKDAY_NAMES[r.weekday];
            const id = (f: string) => `hrs-${branch.id}-${r.weekday}-${f}`;
            return (
              <li key={r.weekday} className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3">
                <p id={id("day")} className="w-28 shrink-0 pt-2 text-sm font-semibold text-ink">{day}</p>
                <div className="pt-1.5">
                  <Checkbox label="Closed" checked={r.closed} disabled={!canEdit} aria-describedby={id("day")} className="items-center text-sm" onChange={(ev) => set(r.weekday, { closed: ev.target.checked })} />
                </div>
                {r.closed ? <p className="pt-2 text-sm text-ink-3">Closed all day</p> : (
                  <div className="flex flex-wrap items-start gap-3">
                    <Field label="Opens" htmlFor={id("opens")} error={e?.opens}>
                      <Input id={id("opens")} type="time" className="h-10 w-32 px-2.5" value={r.opens} disabled={!canEdit} aria-describedby={id("day")} aria-invalid={e?.opens || e?.row ? true : undefined} onChange={(ev) => set(r.weekday, { opens: ev.target.value })} />
                    </Field>
                    <Field label="Closes" htmlFor={id("closes")} error={e?.closes ?? e?.row}>
                      <Input id={id("closes")} type="time" className="h-10 w-32 px-2.5" value={r.closes} disabled={!canEdit} aria-describedby={id("day")} aria-invalid={e?.closes || e?.row ? true : undefined} onChange={(ev) => set(r.weekday, { closes: ev.target.value })} />
                    </Field>
                  </div>
                )}
                {canEdit && (
                  <Button variant="ghost" size="sm" className="ml-auto" aria-label={`Use ${day}’s hours for every day`} onClick={() => { save.clear(); setRows((rs) => copyDay(rs, r.weekday, [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== r.weekday))); }}>Copy to all days</Button>
                )}
              </li>
            );
          })}
        </ul>
        {save.message && <Alert tone="bad" title="The hours weren’t saved">{save.message}</Alert>}
        {dirty && <p role="status" className="text-sm font-medium text-warn">You have unsaved changes to these hours.</p>}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ closures
function ClosuresPanel({ branch }: { branch: Branch }) {
  const { can } = useAdmin();
  const canEdit = can("slots.manage");
  const list = useAdminList<Closure>("/closures/");
  const [showPast, setShowPast] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [removing, setRemoving] = React.useState<Closure | null>(null);
  const today = isoDate(new Date());
  const rows = list.rows.filter((c) => c.branch === branch.id && (showPast || c.date >= today)).sort((a, b) => a.date.localeCompare(b.date));

  const remove = useFormAction((c: Closure) => adminRequest("DELETE", `/closures/${c.id}/`), {
    invalidate: ["/closures"], success: "Closure removed. Slots on that day stay closed until you reopen them.", onSuccess: () => setRemoving(null), onError: () => setRemoving(null),
  });

  const columns: Column<Closure>[] = [
    { key: "date", header: "Date", cell: (c) => (
      <div className="max-sm:max-w-[14rem]">
        <span className="font-semibold">{formatDate(c.date, "en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
        <p className="mt-0.5 text-xs text-ink-2 sm:hidden">{c.reason || "No reason given"}</p>
      </div>
    ) },
    { key: "reason", header: "Reason", className: "hidden sm:table-cell", cell: (c) => c.reason || <span className="text-ink-3">No reason given</span> },
    { key: "state", header: "", className: "hidden sm:table-cell", cell: (c) => (c.date < today ? <ToneBadge tone="neutral">Past</ToneBadge> : null) },
    ...(canEdit ? [{ key: "remove", header: "Remove", className: STICKY_ACTIONS, cell: (c: Closure) => <Button variant="ghost" size="icon-sm" aria-label={`Remove the closure on ${formatDate(c.date)}`} onClick={() => { remove.clear(); setRemoving(c); }}><Trash2 className="size-4" aria-hidden /></Button> }] : []),
  ];

  return (
    <Card title={`Closures · ${branch.name}`} actions={canEdit ? <Button size="sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add closure</Button> : undefined}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">Days the store is shut regardless of its weekly hours, such as bank holidays. Adding a closure closes that day’s open slots. If customers have already booked slots on that day, the closure is refused until those orders are moved or cancelled.</p>
        {!canEdit && <p className="text-sm text-ink-3">Your role can view closures but not change them.</p>}
        {remove.message && <Alert tone="bad" title="The closure wasn’t removed">{remove.message}</Alert>}
        <Checkbox label="Show past closures" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} className="items-center text-sm" />
        <DataTable<Closure> caption={`Closures for ${branch.name}`} columns={columns} rows={rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
          empty={<EmptyState icon={<CalendarOff className="size-7" aria-hidden />} title="No upcoming closures">{canEdit ? "Add a closure for a holiday or a stock-take day." : "This store has no closures coming up."}</EmptyState>} />
      </div>
      {adding && <ClosureDialog branch={branch} onClose={() => setAdding(false)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Remove this closure?" confirmLabel="Remove closure" loading={remove.mutation.isPending}
        description={removing ? `${formatDate(removing.date, "en-US", { weekday: "long", day: "numeric", month: "long" })} will count as an ordinary trading day again. Slots that were closed for it stay closed until you reopen them or generate new ones.` : undefined}
        onConfirm={() => removing && remove.mutation.mutate(removing)} />
    </Card>
  );
}

function ClosureDialog({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const rangeError = closureRangeError(from, to);
  const dates = expandDates(from, to) ?? [];

  const { mutation, message, fieldErrors, clear } = useFormAction(
    async (v: { dates: string[]; reason: string }) => {
      // The API closes one date per request. Stop at the first refusal and say how far we got.
      const done: string[] = [];
      for (const date of v.dates) {
        try {
          await adminRequest("POST", "/closures/", { branch: branch.id, date, reason: v.reason });
          done.push(date);
        } catch (e) {
          qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" });
          if (e instanceof ApiError && v.dates.length > 1) {
            const prefix = `${formatDate(date, "en-US", { day: "numeric", month: "short" })}: `;
            const tail = done.length ? ` ${done.length} earlier ${done.length === 1 ? "day was" : "days were"} closed.` : "";
            throw new ApiError(e.status, e.code, `${prefix}${e.message}${tail}`, e.details, e.requestId);
          }
          throw e;
        }
      }
      return done;
    },
    { invalidate: ["/closures", "/slots"], success: (d) => (d.length === 1 ? "Closure added." : `${d.length} days closed.`), onSuccess: onClose },
  );
  const submit = () => {
    setTouched(true);
    if (rangeError) return;
    mutation.mutate({ dates, reason: reason.trim() });
  };
  const e = fieldErrors.date ?? fieldErrors.non_field_errors ?? (touched ? rangeError ?? undefined : undefined);
  return (
    <FormDialog onClose={onClose} onEdit={clear} title="Add closure" description={`Close ${branch.name} for a day, or for a run of days.`} submitLabel={dates.length > 1 ? `Close ${dates.length} days` : "Add closure"} onSubmit={submit} loading={mutation.isPending} message={message}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First day" htmlFor="clo-from" required error={e}>
          <Input id="clo-from" type="date" min={isoDate(new Date())} value={from} onChange={(ev) => setFrom(ev.target.value)} aria-invalid={e ? true : undefined} />
        </Field>
        <Field label="Last day (optional)" htmlFor="clo-to" hint={`Leave blank for a single day. Up to ${MAX_CLOSURE_DAYS} days.`}>
          <Input id="clo-to" type="date" min={from || isoDate(new Date())} value={to} onChange={(ev) => setTo(ev.target.value)} />
        </Field>
      </div>
      <Field label="Reason (optional)" htmlFor="clo-reason" error={fieldErrors.reason} hint="Shown to staff only. Up to 160 characters.">
        <Input id="clo-reason" maxLength={160} value={reason} onChange={(ev) => setReason(ev.target.value)} />
      </Field>
      {dates.length > 1 && <p role="status" className="text-sm text-ink-2">This closes {dates.length} separate days, one request each. If one of them is refused (for example because customers booked slots that day), the days before it stay closed.</p>}
    </FormDialog>
  );
}

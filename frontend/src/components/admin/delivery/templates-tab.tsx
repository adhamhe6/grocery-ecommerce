"use client";

import { CalendarClock, Plus } from "lucide-react";
import * as React from "react";
import { FormDialog, RowMenu, STICKY_ACTIONS, ToneBadge, useFormAction } from "@/components/admin/inventory/form-kit";
import { ConfirmDialog, DataTable, type Column } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { Checkbox, Field, Input, Select, describedBy } from "@/components/ui/field";
import { adminRequest, useAdmin, useAdminList } from "@/lib/admin";
import { formatTimeRange } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { WEEKDAY_NAMES } from "./hours";
import { templateErrors, templatePayload, timeInput, type TemplateForm } from "./forms";
import type { SlotKind, SlotTemplate, Zone } from "./types";

export function TemplatesTab({ branchId }: { branchId: number | null }) {
  const { can, branches } = useAdmin();
  const money = useMoney();
  const canManage = can("slots.manage");
  const templates = useAdminList<SlotTemplate>("/slot-templates/");
  const zones = useAdminList<Zone>("/zones/");
  const [dialog, setDialog] = React.useState<{ template?: SlotTemplate } | null>(null);
  const [removing, setRemoving] = React.useState<SlotTemplate | null>(null);
  const rows = templates.rows.filter((t) => t.branch === branchId);
  const zoneName = (id: number | null) => zones.rows.find((z) => z.id === id)?.name ?? (id ? `Zone ${id}` : "");
  const storeName = branches.find((b) => b.id === branchId)?.name ?? "this store";

  const remove = useFormAction((t: SlotTemplate) => adminRequest("DELETE", `/slot-templates/${t.id}/`), {
    invalidate: ["/slot-templates"], success: "Template deleted.", onSuccess: () => setRemoving(null), onError: () => setRemoving(null),
  });

  const columns: Column<SlotTemplate>[] = [
    { key: "day", header: "Day", cell: (t) => <span className="font-semibold">{WEEKDAY_NAMES[t.weekday]}</span> },
    { key: "time", header: "Window", cell: (t) => (
      <div className="max-sm:max-w-[14rem]">
        <span className="whitespace-nowrap">{formatTimeRange(t.start_time, t.end_time)}</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-1 sm:hidden">
          <ToneBadge tone={t.kind === "DELIVERY" ? "info" : "citrus"}>{t.kind === "DELIVERY" ? "Delivery" : "Pickup"}</ToneBadge>
          {t.is_active ? <ToneBadge tone="ok">Active</ToneBadge> : <ToneBadge tone="neutral">Paused</ToneBadge>}
          <span className="text-xs text-ink-2">{t.capacity} per slot{t.zone ? ` · ${zoneName(t.zone)}` : ""}</span>
        </div>
      </div>
    ) },
    { key: "kind", header: "Type", className: "hidden sm:table-cell", cell: (t) => <ToneBadge tone={t.kind === "DELIVERY" ? "info" : "citrus"}>{t.kind === "DELIVERY" ? "Delivery" : "Pickup"}</ToneBadge> },
    { key: "zone", header: "Zone", className: "hidden md:table-cell", cell: (t) => (t.zone ? zoneName(t.zone) : <span className="text-ink-3">Not applicable</span>) },
    { key: "capacity", header: "Capacity", align: "right", className: "hidden sm:table-cell", cell: (t) => t.capacity },
    { key: "fee", header: "Fee", align: "right", className: "hidden md:table-cell", cell: (t) => (t.fee !== null ? money(t.fee) : <span className="text-ink-3">{t.kind === "DELIVERY" ? "Zone fee" : "No fee"}</span>) },
    { key: "status", header: "Status", className: "hidden sm:table-cell", cell: (t) => (t.is_active ? <ToneBadge tone="ok">Active</ToneBadge> : <ToneBadge tone="neutral">Paused</ToneBadge>) },
    ...(canManage ? [{ key: "actions", header: "Actions", className: STICKY_ACTIONS, cell: (t: SlotTemplate) => (
      <RowMenu label={`Actions for the ${WEEKDAY_NAMES[t.weekday]} ${formatTimeRange(t.start_time, t.end_time)} template`} actions={[
        { label: "Edit template…", onSelect: () => setDialog({ template: t }) },
        { label: "Delete template…", danger: true, onSelect: () => { remove.clear(); setRemoving(t); } },
      ]} />
    ) }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-2">The weekly pattern for {storeName}. Each active template becomes real, bookable slots when you generate them. Changing a template does not change slots that already exist.</p>
        {canManage && <Button disabled={!branchId} onClick={() => setDialog({})}><Plus className="size-4" aria-hidden /> New template</Button>}
      </div>
      {remove.message && <Alert tone="bad" title="The template wasn’t deleted">{remove.message}</Alert>}
      <DataTable<SlotTemplate> caption={`Slot templates for ${storeName}`} columns={columns} rows={rows} loading={templates.isLoading} error={templates.error} onRetry={() => templates.refetch()}
        empty={<EmptyState icon={<CalendarClock className="size-7" aria-hidden />} title="No slot templates" action={canManage ? <Button onClick={() => setDialog({})}>Add a template</Button> : undefined}>Add the time windows customers can book each week, then generate slots from them.</EmptyState>} />
      {dialog && <TemplateDialog template={dialog.template} branchId={branchId} zones={zones.rows} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title="Delete this template?" confirmLabel="Delete template" danger loading={remove.mutation.isPending}
        description="No new slots will be made from it. Slots already generated stay as they are; close them individually if you don’t want them offered."
        onConfirm={() => removing && remove.mutation.mutate(removing)} />
    </div>
  );
}

function TemplateDialog({ template, branchId, zones, onClose }: { template?: SlotTemplate; branchId: number | null; zones: Zone[]; onClose: () => void }) {
  const { branches } = useAdmin();
  const editing = !!template;
  const [f, setF] = React.useState<TemplateForm>({
    branch: template?.branch ?? branchId, kind: template?.kind ?? "DELIVERY", zone: template?.zone ?? null, weekday: template?.weekday ?? 0,
    start: timeInput(template?.start_time), end: timeInput(template?.end_time), capacity: String(template?.capacity ?? 6), fee: template?.fee ?? "", active: template?.is_active ?? true,
  });
  const [touched, setTouched] = React.useState(false);
  const set = (p: Partial<TemplateForm>) => setF((x) => ({ ...x, ...p }));
  const branchZones = zones.filter((z) => z.branch === f.branch);
  const { mutation, message, fieldErrors: fe, clear } = useFormAction(
    (body: ReturnType<typeof templatePayload>) => (editing ? adminRequest<SlotTemplate>("PATCH", `/slot-templates/${template!.id}/`, body) : adminRequest<SlotTemplate>("POST", "/slot-templates/", body)),
    { invalidate: ["/slot-templates"], success: editing ? "Template saved." : "Template created. Generate slots to put it on sale.", onSuccess: onClose },
  );
  const errors = templateErrors(f);
  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    mutation.mutate(templatePayload(f));
  };
  const e = (k: string, server?: string) => server ?? (touched ? errors[k] : undefined);
  const bad = (k: string, server?: string) => (e(k, server) ? true : undefined);

  return (
    <FormDialog wide onClose={onClose} onEdit={clear} title={editing ? "Edit slot template" : "New slot template"} submitLabel={editing ? "Save template" : "Create template"} onSubmit={submit} loading={mutation.isPending} message={message ?? fe.non_field_errors ?? null}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Store" htmlFor="tp-branch" required error={e("branch", fe.branch)}>
          <Select id="tp-branch" value={f.branch ?? ""} onChange={(ev) => set({ branch: ev.target.value ? Number(ev.target.value) : null, zone: null })} aria-invalid={bad("branch", fe.branch)}>
            <option value="">Choose a store</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Type" htmlFor="tp-kind" required error={fe.kind}>
          <Select id="tp-kind" value={f.kind} onChange={(ev) => set({ kind: ev.target.value as SlotKind })}>
            <option value="DELIVERY">Delivery</option>
            <option value="PICKUP">Pickup</option>
          </Select>
        </Field>
        {f.kind === "DELIVERY" && (
          <Field label="Delivery zone" htmlFor="tp-zone" required error={e("zone", fe.zone)} hint={f.branch && !branchZones.length ? "This store has no delivery zones yet. Add one on Stores and delivery zones." : "Customers in this zone can book the slot."} className="sm:col-span-2">
            <Select id="tp-zone" value={f.zone ?? ""} onChange={(ev) => set({ zone: ev.target.value ? Number(ev.target.value) : null })} aria-invalid={bad("zone", fe.zone)} aria-describedby={describedBy("tp-zone", true, !!e("zone", fe.zone))}>
              <option value="">Choose a zone</option>
              {branchZones.map((z) => <option key={z.id} value={z.id}>{z.name}{z.is_active ? "" : " (inactive)"}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Day of the week" htmlFor="tp-day" required error={fe.weekday}>
          <Select id="tp-day" value={f.weekday} onChange={(ev) => set({ weekday: Number(ev.target.value) })}>
            {WEEKDAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </Select>
        </Field>
        <Field label="Capacity" htmlFor="tp-cap" required error={e("capacity", fe.capacity)} hint="Orders that can book each slot made from this template.">
          <Input id="tp-cap" inputMode="numeric" value={f.capacity} onChange={(ev) => set({ capacity: ev.target.value })} aria-invalid={bad("capacity", fe.capacity)} aria-describedby={describedBy("tp-cap", true, !!e("capacity", fe.capacity))} />
        </Field>
        <Field label="Starts" htmlFor="tp-start" required error={e("start", fe.start_time)}>
          <Input id="tp-start" type="time" value={f.start} onChange={(ev) => set({ start: ev.target.value })} aria-invalid={bad("start", fe.start_time)} />
        </Field>
        <Field label="Ends" htmlFor="tp-end" required error={e("end", fe.end_time)}>
          <Input id="tp-end" type="time" value={f.end} onChange={(ev) => set({ end: ev.target.value })} aria-invalid={bad("end", fe.end_time)} />
        </Field>
        <Field label="Fee override (optional)" htmlFor="tp-fee" error={e("fee", fe.fee)} hint={f.kind === "DELIVERY" ? "Leave blank to charge the zone’s delivery fee." : "Leave blank for no fee."} className="sm:col-span-2">
          <Input id="tp-fee" inputMode="decimal" value={f.fee} onChange={(ev) => set({ fee: ev.target.value })} aria-invalid={bad("fee", fe.fee)} aria-describedby={describedBy("tp-fee", true, !!e("fee", fe.fee))} />
        </Field>
      </div>
      <Checkbox label="Active (included when slots are generated)" checked={f.active} onChange={(ev) => set({ active: ev.target.checked })} />
      <p className="text-xs text-ink-3">How early a customer must order is set by the store’s preparation time on Stores and delivery zones, not per template.</p>
    </FormDialog>
  );
}

"use client";

import { Map as MapIcon, Plus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { FormDialog, RowMenu, STICKY_ACTIONS, StoreSelect, ToneBadge, useFormAction, useWorkingBranch } from "@/components/admin/inventory/form-kit";
import { ConfirmDialog, DataTable, type Column } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea, describedBy } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { adminRequest, useAdmin, useAdminList } from "@/lib/admin";
import { useMoney } from "@/lib/hooks";
import { zoneErrors, zonePayload, type ZoneForm } from "./forms";
import type { Zone } from "./types";

function Coverage({ z }: { z: Zone }) {
  return (
    <div className="space-y-1">
      {z.postcode_prefixes.length > 0 && <p className="text-xs"><span className="font-semibold text-ink-2">Postcodes starting </span><span className="break-words">{z.postcode_prefixes.join(", ")}</span></p>}
      {z.areas.length > 0 && <p className="text-xs"><span className="font-semibold text-ink-2">Areas </span><span className="break-words">{z.areas.join(", ")}</span></p>}
      {!z.postcode_prefixes.length && !z.areas.length && <p className="text-xs text-warn">Covers nowhere yet</p>}
    </div>
  );
}

export function ZonesTab() {
  const { can, branches } = useAdmin();
  const money = useMoney();
  const canManage = can("branches.manage");
  const [branchId, setBranchId] = useWorkingBranch();
  const list = useAdminList<Zone>("/zones/");
  const [dialog, setDialog] = React.useState<{ zone?: Zone } | null>(null);
  const [removing, setRemoving] = React.useState<Zone | null>(null);
  const rows = list.rows.filter((z) => z.branch === branchId);
  const storeName = branches.find((b) => b.id === branchId)?.name ?? "this store";

  const remove = useFormAction((z: Zone) => adminRequest("DELETE", `/zones/${z.id}/`), { invalidate: ["/zones", "/slot"], success: "Zone deleted.", onSuccess: () => setRemoving(null), onError: () => setRemoving(null) });

  const columns: Column<Zone>[] = [
    { key: "name", header: "Zone", cell: (z) => (
      <div className="min-w-32 max-sm:max-w-[14rem]">
        <p className="font-semibold text-ink">{z.name}</p>
        <p className="text-xs text-ink-3">Priority {z.priority}{z.priority === 100 ? " (default)" : ""}</p>
        <div className="mt-1.5 space-y-1 sm:hidden">
          <Coverage z={z} />
          <p className="num text-xs text-ink-2">Fee {money(z.delivery_fee)}{z.free_delivery_threshold ? `, free over ${money(z.free_delivery_threshold)}` : ""}</p>
          {z.is_active ? <ToneBadge tone="ok">Active</ToneBadge> : <ToneBadge tone="neutral">Inactive</ToneBadge>}
        </div>
      </div>
    ) },
    { key: "coverage", header: "Covers", className: "hidden sm:table-cell", cell: (z) => <div className="max-w-72"><Coverage z={z} /></div> },
    { key: "fee", header: "Delivery fee", align: "right", className: "hidden sm:table-cell", cell: (z) => money(z.delivery_fee) },
    { key: "free", header: "Free over", align: "right", className: "hidden md:table-cell", cell: (z) => (z.free_delivery_threshold ? money(z.free_delivery_threshold) : <span className="text-ink-3">Never free</span>) },
    { key: "min", header: "Minimum order", align: "right", className: "hidden md:table-cell", cell: (z) => (Number(z.min_order_value) > 0 ? money(z.min_order_value) : <span className="text-ink-3">None</span>) },
    { key: "status", header: "Status", className: "hidden sm:table-cell", cell: (z) => (z.is_active ? <ToneBadge tone="ok">Active</ToneBadge> : <ToneBadge tone="neutral">Inactive</ToneBadge>) },
    ...(canManage ? [{ key: "actions", header: "Actions", className: STICKY_ACTIONS, cell: (z: Zone) => (
      <RowMenu label={`Actions for zone ${z.name}`} actions={[
        { label: "Edit zone…", onSelect: () => setDialog({ zone: z }) },
        { label: "Delete zone…", danger: true, onSelect: () => { remove.clear(); setRemoving(z); } },
      ]} />
    ) }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-2">Where {storeName} delivers, and what it charges. A customer’s address belongs to the first matching zone, lowest priority number first. How many deliveries fit in each time window is set per slot template on <Link className="underline" href="/admin/slots">Delivery slots</Link>, not per zone.</p>
        <div className="flex flex-wrap items-center gap-3">
          <StoreSelect id="zones-store" value={branchId} onChange={setBranchId} />
          {canManage && <Button onClick={() => setDialog({})}><Plus className="size-4" aria-hidden /> New zone</Button>}
        </div>
      </div>
      {!canManage && <p className="text-sm text-ink-3">Your role can view delivery zones but not change them.</p>}
      {remove.message && <p role="alert" className="text-sm font-medium text-bad">{remove.message}</p>}
      <DataTable<Zone> caption={`Delivery zones for ${storeName}`} columns={columns} rows={rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState icon={<MapIcon className="size-7" aria-hidden />} title="No delivery zones" action={canManage ? <Button onClick={() => setDialog({})}>Add a zone</Button> : undefined}>Without a zone, customers can’t get home delivery from {storeName}.</EmptyState>} />
      {dialog && <ZoneDialog zone={dialog.zone} defaultBranch={branchId} onClose={() => setDialog(null)} />}
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={removing ? `Delete the ${removing.name} zone?` : ""} confirmLabel="Delete zone" danger loading={remove.mutation.isPending}
        description="Its delivery slot templates and generated slots are deleted with it. Customers in this area will no longer be able to order delivery. To pause a zone instead, mark it inactive."
        onConfirm={() => removing && remove.mutation.mutate(removing)} />
    </div>
  );
}

function ZoneDialog({ zone, defaultBranch, onClose }: { zone?: Zone; defaultBranch: number | null; onClose: () => void }) {
  const { branches } = useAdmin();
  const editing = !!zone;
  const [f, setF] = React.useState<ZoneForm>({
    branch: zone?.branch ?? defaultBranch, name: zone?.name ?? "", postcodes: zone?.postcode_prefixes.join(", ") ?? "", areas: zone?.areas.join(", ") ?? "",
    fee: zone?.delivery_fee ?? "0.00", freeOver: zone?.free_delivery_threshold ?? "", minOrder: zone?.min_order_value ?? "0.00", priority: String(zone?.priority ?? 100), active: zone?.is_active ?? true,
  });
  const [touched, setTouched] = React.useState(false);
  const set = (p: Partial<ZoneForm>) => setF((x) => ({ ...x, ...p }));
  const { mutation, message, fieldErrors: fe, clear } = useFormAction(
    (body: ReturnType<typeof zonePayload>) => (editing ? adminRequest<Zone>("PATCH", `/zones/${zone!.id}/`, body) : adminRequest<Zone>("POST", "/zones/", body)),
    { invalidate: ["/zones", "/slot"], success: editing ? "Zone saved." : "Zone created.", onSuccess: onClose },
  );
  const errors = zoneErrors(f, !editing);
  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length) return;
    mutation.mutate(zonePayload(f));
  };
  const e = (k: string, server?: string) => server ?? (touched ? errors[k] : undefined);

  return (
    <FormDialog wide onClose={onClose} onEdit={clear} title={editing ? `Edit ${zone!.name}` : "New delivery zone"} submitLabel={editing ? "Save zone" : "Create zone"} onSubmit={submit} loading={mutation.isPending} message={message ?? fe.non_field_errors ?? null}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Store" htmlFor="zn-branch" required error={e("branch", fe.branch)}>
          <Select id="zn-branch" value={f.branch ?? ""} onChange={(ev) => set({ branch: ev.target.value ? Number(ev.target.value) : null })} aria-invalid={e("branch", fe.branch) ? true : undefined}>
            <option value="">Choose a store</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Zone name" htmlFor="zn-name" required error={e("name", fe.name)}>
          <Input id="zn-name" maxLength={80} value={f.name} onChange={(ev) => set({ name: ev.target.value })} aria-invalid={e("name", fe.name) ? true : undefined} aria-describedby={describedBy("zn-name", false, !!e("name", fe.name))} />
        </Field>
        <Field label="Postcode prefixes" htmlFor="zn-post" error={e("postcodes", fe.postcode_prefixes)} hint="Separate with commas or new lines. A customer’s postcode matches when it starts with a prefix, ignoring spaces and case: RW3 covers RW3 4AB.">
          <Textarea id="zn-post" className="min-h-20" value={f.postcodes} onChange={(ev) => set({ postcodes: ev.target.value })} aria-invalid={e("postcodes", fe.postcode_prefixes) ? true : undefined} aria-describedby={describedBy("zn-post", true, !!e("postcodes", fe.postcode_prefixes))} />
        </Field>
        <Field label="Areas" htmlFor="zn-areas" error={fe.areas} hint="District names, matched exactly but ignoring case: Old Town. Add postcodes, areas or both.">
          <Textarea id="zn-areas" className="min-h-20" value={f.areas} onChange={(ev) => set({ areas: ev.target.value })} />
        </Field>
        <Field label="Delivery fee" htmlFor="zn-fee" required error={e("fee", fe.delivery_fee)} hint="Changing it updates future slots that don’t have their own fee.">
          <Input id="zn-fee" inputMode="decimal" value={f.fee} onChange={(ev) => set({ fee: ev.target.value })} aria-invalid={e("fee", fe.delivery_fee) ? true : undefined} aria-describedby={describedBy("zn-fee", true, !!e("fee", fe.delivery_fee))} />
        </Field>
        <Field label="Free delivery over" htmlFor="zn-free" error={e("freeOver", fe.free_delivery_threshold)} hint="Order value above which delivery is free. Leave blank for never.">
          <Input id="zn-free" inputMode="decimal" value={f.freeOver} onChange={(ev) => set({ freeOver: ev.target.value })} aria-invalid={e("freeOver", fe.free_delivery_threshold) ? true : undefined} aria-describedby={describedBy("zn-free", true, !!e("freeOver", fe.free_delivery_threshold))} />
        </Field>
        <Field label="Minimum order" htmlFor="zn-min" required error={e("minOrder", fe.min_order_value)}>
          <Input id="zn-min" inputMode="decimal" value={f.minOrder} onChange={(ev) => set({ minOrder: ev.target.value })} aria-invalid={e("minOrder", fe.min_order_value) ? true : undefined} aria-describedby={describedBy("zn-min", false, !!e("minOrder", fe.min_order_value))} />
        </Field>
        <Field label="Priority" htmlFor="zn-prio" required error={e("priority", fe.priority)} hint="Lower numbers win when an address matches several zones.">
          <Input id="zn-prio" inputMode="numeric" value={f.priority} onChange={(ev) => set({ priority: ev.target.value })} aria-invalid={e("priority", fe.priority) ? true : undefined} aria-describedby={describedBy("zn-prio", true, !!e("priority", fe.priority))} />
        </Field>
      </div>
      <Checkbox label="Active (customers in this zone can order delivery)" checked={f.active} onChange={(ev) => set({ active: ev.target.checked })} />
    </FormDialog>
  );
}

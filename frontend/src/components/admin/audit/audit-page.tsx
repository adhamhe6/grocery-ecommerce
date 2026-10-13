"use client";

import * as React from "react";
import { DataTable, FilterBar, Pager, useDebouncedValue, type Column } from "@/components/admin/kit";
import { AdminPage } from "@/components/admin/kit";
import { useStoreDateTime } from "@/components/admin/finance/format";
import { DateFilter, Mono } from "@/components/admin/finance/parts";
import { useUrlState } from "@/components/admin/finance/url-state";
import { RequireCapability } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, Skeleton } from "@/components/ui/states";
import { useAdminGet, useAdminList } from "@/lib/admin";
import { AuditDrawer, type AuditEntry } from "./audit-drawer";

const DEFAULTS = { actor: "", action: "", ttype: "", tid: "", from: "", to: "", page: "1" };

export function AuditPage() {
  return (
    <RequireCapability any={["audit.read"]}>
      <React.Suspense fallback={<div className="space-y-4" aria-busy="true"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>}>
        <AuditInner />
      </React.Suspense>
    </RequireCapability>
  );
}

function TextFilter({ id, label, value, onChange, placeholder, list, width = "w-44" }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; list?: string; width?: string }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <span className="font-semibold text-ink-2">{label}</span>
      <Input id={id} className={`h-10 text-sm ${width}`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} list={list} autoComplete="off" spellCheck={false} />
    </label>
  );
}

function AuditInner() {
  const when = useStoreDateTime({ seconds: true, compact: true });
  const [s, set] = useUrlState(DEFAULTS);
  const [open, setOpen] = React.useState<AuditEntry | null>(null);
  const actor = useDebouncedValue(s.actor.trim());
  const action = useDebouncedValue(s.action.trim());
  const ttype = useDebouncedValue(s.ttype.trim());
  const tid = useDebouncedValue(s.tid.trim());
  const page = Math.max(1, Number(s.page) || 1);
  const names = useAdminGet<string[]>("/audit/actions/");
  const list = useAdminList<AuditEntry>("/audit/", { actor, action, target_type: ttype, target_id: tid, date_from: s.from, date_to: s.to, page });
  const filtered = !!(s.actor || s.action || s.ttype || s.tid || s.from || s.to);
  const clear = () => set({ ...DEFAULTS });
  const change = (patch: Partial<typeof DEFAULTS>) => set({ ...patch, page: "1" });

  const columns: Column<AuditEntry>[] = [
    { key: "time", header: "Time", cell: (e) => <span className="whitespace-nowrap">{when(e.created_at)}</span> },
    { key: "actor", header: "Actor", cell: (e) => <span className="break-all">{e.actor_email || "system"}</span> },
    { key: "action", header: "Action", cell: (e) => <Mono className="text-sm">{e.action}</Mono> },
    { key: "target", header: "Target", hideBelow: "md", cell: (e) => (e.target_type ? <span className="whitespace-nowrap">{e.target_type}{e.target_id && <span className="text-ink-3"> #{e.target_id}</span>}</span> : <span className="text-ink-3">—</span>) },
    { key: "summary", header: "Summary", hideBelow: "lg", cell: (e) => <span className="line-clamp-2 max-w-md">{e.summary || <span className="text-ink-3">—</span>}</span> },
    { key: "source", header: "IP / request", hideBelow: "lg", cell: (e) => (e.ip_address || e.request_id ? <div className="space-y-0.5 text-xs text-ink-2">{e.ip_address && <div className="num">{e.ip_address}</div>}{e.request_id && <Mono className="text-ink-3">{e.request_id}</Mono>}</div> : <span className="text-ink-3">—</span>) },
    { key: "open", header: "Details", cell: (e) => <Button size="sm" variant="ghost" onClick={(ev) => { ev.stopPropagation(); setOpen(e); }} aria-label={`Open details of ${e.action} at ${when(e.created_at)}`}>Open</Button> },
  ];

  return (
    <AdminPage title="Audit log" description="A permanent record of who did what and when. Entries can't be edited or deleted. Open an entry to see exactly which fields changed.">
      <datalist id="audit-actions">{(names.data ?? []).map((a) => <option key={a} value={a} />)}</datalist>
      <FilterBar>
        <TextFilter id="audit-actor" label="Actor" value={s.actor} onChange={(v) => change({ actor: v })} placeholder="Email or “system”" width="w-52" />
        <TextFilter id="audit-action" label="Action starts with" value={s.action} onChange={(v) => change({ action: v })} placeholder="e.g. product." list="audit-actions" width="w-52" />
        <TextFilter id="audit-ttype" label="Target type" value={s.ttype} onChange={(v) => change({ ttype: v })} placeholder="e.g. Product" width="w-40" />
        <TextFilter id="audit-tid" label="Target id" value={s.tid} onChange={(v) => change({ tid: v })} width="w-28" />
        <DateFilter label="From" value={s.from} max={s.to || undefined} onChange={(v) => change({ from: v })} />
        <DateFilter label="To" value={s.to} min={s.from || undefined} onChange={(v) => change({ to: v })} />
        {filtered && <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button>}
      </FilterBar>
      <p className="-mt-3 text-sm text-ink-3">The actor filter matches part of an email; the action filter matches the start of the action name; target type must match exactly (upper or lower case). Dates are calendar days.</p>

      <DataTable
        caption="Audit log, newest first"
        columns={columns}
        rows={list.rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        onRowClick={(e) => setOpen(e)}
        dense
        empty={filtered
          ? <EmptyState title="No entries match these filters" action={<Button variant="secondary" onClick={clear}>Clear filters</Button>}>Try fewer filters or a wider date range.</EmptyState>
          : <EmptyState title="Nothing recorded yet">Changes made by staff and by the system will appear here.</EmptyState>}
      />
      {!list.error && !list.isLoading && <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={(p) => set({ page: String(p) })} label="entries" />}
      <AuditDrawer entry={open} onClose={() => setOpen(null)} />
    </AdminPage>
  );
}

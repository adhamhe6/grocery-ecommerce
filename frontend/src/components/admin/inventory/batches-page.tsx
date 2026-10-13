"use client";

import { AlertTriangle, Boxes, CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import * as React from "react";
import { AdminPage, Card, DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { useAdmin, useAdminGet, useAdminList } from "@/lib/admin";
import { formatDate, formatQty } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { BatchStatusBadge, ExpiredExplainer, QualityBadge, useBatchActions } from "./batch-actions";
import { EXPIRY_BUCKETS, daysLabel, expiryBucket, type ExpiryBucket } from "./expiry";
import { LiveCount, RowMenu, STICKY_ACTIONS, ToneBadge, usePage, type MenuAction } from "./form-kit";
import type { BatchRow, ExpiryData, ExpiryGroupKey } from "./types";

const KIND_LABEL = { BEST_BEFORE: "Best before", USE_BY: "Use by" } as const;
const BUCKET_STYLE: Record<ExpiryGroupKey, { tone: "bad" | "warn" | "info"; icon: typeof XCircle }> = {
  expired: { tone: "bad", icon: XCircle },
  today_tomorrow: { tone: "bad", icon: AlertTriangle },
  within_3: { tone: "warn", icon: AlertTriangle },
  within_7: { tone: "info", icon: CalendarClock },
};
const day = (d: string | null) => (d ? formatDate(d, "en-US", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function BatchesPage() {
  const actions = useBatchActions();
  return (
    <RequireCapability any={["inventory.read"]}>
      <AdminPage title="Batches and expiry" description="Every lot on hand, what is about to expire, and the tools to block, release or write off a batch.">
        <ExpiredExplainer />
        <ExpiryBoard menuFor={actions.menuFor} />
        <BatchTable menuFor={actions.menuFor} />
        {actions.dialogs}
      </AdminPage>
    </RequireCapability>
  );
}

// ------------------------------------------------------------------------------------------------ expiry board
function ExpiryBoard({ menuFor }: { menuFor: (b: BatchRow) => MenuAction[] }) {
  const { branchId } = useAdmin();
  const money = useMoney();
  const q = useAdminGet<ExpiryData>("/inventory/expiry/", { branch: branchId ?? undefined });
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  if (q.error) return <Card title="Expiry board"><ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load the expiry board" /></Card>;
  const d = q.data;
  const total = d ? Object.values(d.totals).reduce((n, t) => n + t.batches, 0) : 0;
  return (
    <section aria-label="Expiry board" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-sans text-base font-bold text-ink">Expiry board</h2>
        <p className="text-sm text-ink-3">{d ? `Batches with stock that expire within 7 days, or already have. As of ${day(d.today)}.` : "Loading…"}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {EXPIRY_BUCKETS.map((b) => {
          const style = BUCKET_STYLE[b.key];
          const rows = d?.groups[b.key] ?? [];
          const totals = d?.totals[b.key];
          const expanded = open[b.key];
          const shown = expanded ? rows : rows.slice(0, 5);
          return (
            <Card key={b.key} title={b.label} actions={d ? <ToneBadge tone={rows.length ? style.tone : "neutral"} icon={rows.length ? style.icon : CheckCircle2}>{totals?.batches ?? 0} {totals?.batches === 1 ? "batch" : "batches"}</ToneBadge> : undefined} padded={false}>
              {!d ? <div className="space-y-2 p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : (
                <div className="p-4">
                  <p className="text-xs text-ink-3">{b.hint}. {Number(totals?.value) > 0 ? <>At cost: <span className="num font-semibold text-ink-2">{money(totals!.value)}</span></> : "Cost unknown or nil."}</p>
                  {!rows.length ? <p className="mt-3 flex items-center gap-2 text-sm text-ink-2"><CheckCircle2 className="size-4 text-ok" aria-hidden /> Nothing here.</p> : (
                    <ul className="mt-2 divide-y divide-line">
                      {shown.map((r) => (
                        <li key={r.id} className="flex items-start justify-between gap-2 py-2.5 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{r.name}</p>
                            <p className="truncate text-xs text-ink-3">Lot {r.lot_code} · {r.branch}</p>
                            <p className="num text-xs text-ink-2">{daysLabel(r.days_to_expiry)} · {formatQty(r.qty_remaining, r.unit)} on hand</p>
                          </div>
                          <RowMenu label={`Actions for lot ${r.lot_code} of ${r.name}`} actions={menuFor(r)} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {rows.length > 5 && <Button variant="link" className="mt-2 text-sm" aria-expanded={!!expanded} onClick={() => setOpen((o) => ({ ...o, [b.key]: !expanded }))}>{expanded ? "Show fewer" : `Show all ${rows.length}`}</Button>}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {total >= 500 && <p className="text-xs text-ink-3">The board lists the 500 most urgent batches; use the table below to see the rest.</p>}
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ batch table
const STATUS_OPTIONS: [string, string][] = [["ACTIVE", "Active"], ["QUARANTINED", "Quarantined"], ["EXPIRED", "Expired"], ["DEPLETED", "Used up"]];
const WINDOW_OPTIONS: [string, string][] = [["expired", "Already expired"], ["3", "Expiring within 3 days"], ["7", "Expiring within 7 days"], ["14", "Expiring within 14 days"], ["30", "Expiring within 30 days"]];

function ExpiryCell({ b }: { b: BatchRow }) {
  const bucket: ExpiryBucket = expiryBucket(b.days_to_expiry, b.qty_remaining);
  const style = bucket === "expired" || bucket === "today_tomorrow" || bucket === "within_3" || bucket === "within_7" ? BUCKET_STYLE[bucket] : null;
  return (
    <div className="min-w-36">
      <p className="whitespace-nowrap font-medium text-ink">{day(b.expiry_date)} <span className="text-xs font-normal text-ink-3">· {KIND_LABEL[b.expiry_kind] ?? b.expiry_kind}</span></p>
      {b.expiry_date && Number(b.qty_remaining) > 0 && (style
        ? <ToneBadge tone={style.tone} icon={style.icon} className="mt-1">{daysLabel(b.days_to_expiry)}</ToneBadge>
        : <p className="mt-0.5 text-xs text-ink-2">{daysLabel(b.days_to_expiry)}</p>)}
      <p className="mt-1 whitespace-nowrap text-xs text-ink-3">Sellable until {day(b.sellable_until)}</p>
    </div>
  );
}

function BatchTable({ menuFor }: { menuFor: (b: BatchRow) => MenuAction[] }) {
  const { branchId } = useAdmin();
  const money = useMoney();
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search.trim());
  const [status, setStatus] = React.useState("");
  const [within, setWithin] = React.useState("");
  const [onHand, setOnHand] = React.useState(true);
  const [page, setPage] = usePage(JSON.stringify([q, status, within, onHand, branchId]));
  const list = useAdminList<BatchRow>("/inventory/batches/", {
    branch: branchId ?? undefined, search: q || undefined, status: status || undefined, on_hand: onHand ? "true" : undefined,
    expired: within === "expired" ? "true" : undefined, expiring_within: within && within !== "expired" ? within : undefined, page, page_size: 25,
  });
  const filtered = !!(q || status || within);

  // Lot and product carry their secondary details (received date, supplier, store) underneath so the table fits next to the sidebar.
  const columns: Column<BatchRow>[] = [
    { key: "lot", header: "Lot", cell: (b) => (
      <div>
        <p className="whitespace-nowrap font-mono text-[0.8rem] font-semibold text-ink">{b.lot_code}</p>
        <p className="mt-0.5 whitespace-nowrap text-xs text-ink-3">Received {day(b.received_on)}</p>
      </div>
    ) },
    { key: "product", header: "Product", cell: (b) => (
      <div className="min-w-40 max-md:max-w-[14rem]">
        <p className="font-semibold text-ink">{b.name}</p>
        <p className="text-xs text-ink-3">{b.sku}{branchId === null ? ` · ${b.branch}` : ""}{b.supplier ? ` · from ${b.supplier}` : ""}</p>
        <div className="mt-1.5 space-y-1 md:hidden">
          <div className="flex flex-wrap items-center gap-1"><BatchStatusBadge batch={b} /><QualityBadge quality={b.quality_status} /></div>
          <p className="num text-xs text-ink-2">{formatQty(b.qty_remaining, b.unit)} left · {b.expiry_date ? `${day(b.expiry_date)} (${KIND_LABEL[b.expiry_kind] ?? b.expiry_kind})` : "no expiry"}</p>
          {b.expiry_date && Number(b.qty_remaining) > 0 && <p className="text-xs font-semibold text-ink">{daysLabel(b.days_to_expiry)}</p>}
        </div>
      </div>
    ) },
    { key: "expiry", header: "Expiry", className: "hidden md:table-cell", cell: (b) => <ExpiryCell b={b} /> },
    { key: "remaining", header: "Remaining", align: "right", className: "hidden md:table-cell", cell: (b) => (
      <div><p className="whitespace-nowrap font-semibold">{formatQty(b.qty_remaining, b.unit)}</p>{Number(b.qty_reserved) > 0 && <p className="whitespace-nowrap text-xs font-normal text-ink-3">{formatQty(b.qty_reserved)} reserved</p>}{b.unit_cost && <p className="whitespace-nowrap text-xs font-normal text-ink-3 lg:hidden">{money(b.unit_cost)} each</p>}</div>
    ) },
    { key: "cost", header: "Unit cost", align: "right", className: "hidden lg:table-cell", cell: (b) => (b.unit_cost ? money(b.unit_cost) : <span className="text-ink-3">Unknown</span>) },
    { key: "status", header: "Status and quality", className: "hidden md:table-cell", cell: (b) => (
      <div className="flex flex-col items-start gap-1">
        <BatchStatusBadge batch={b} />
        <QualityBadge quality={b.quality_status} />
        {b.status === "ACTIVE" && !b.can_sell && Number(b.qty_remaining) > 0 && <p className="text-xs text-warn">Not sellable right now</p>}
      </div>
    ) },
    { key: "actions", header: "Actions", className: STICKY_ACTIONS, cell: (b) => <RowMenu label={`Actions for lot ${b.lot_code} of ${b.name}`} actions={menuFor(b)} /> },
  ];

  return (
    <section aria-label="All batches" className="space-y-3">
      <h2 className="font-sans text-base font-bold text-ink">All batches</h2>
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Lot, product or SKU…" label="Search batches" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} allLabel="Any status" />
        <FilterSelect label="Expiry" value={within} onChange={setWithin} options={WINDOW_OPTIONS} allLabel="Any date" />
        <Checkbox label="Only batches with stock" checked={onHand} onChange={(e) => setOnHand(e.target.checked)} className="items-center text-sm" />
      </FilterBar>
      <LiveCount count={list.count} noun="batches" loading={list.isLoading} />
      <DataTable<BatchRow> caption="Batches, soonest expiry first" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState icon={<Boxes className="size-7" aria-hidden />} title={filtered ? "No batches match" : "No batches yet"}>{filtered ? "Try clearing a filter." : "Batches are created when batch-tracked goods are received against a purchase order."}</EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="batches" />
    </section>
  );
}

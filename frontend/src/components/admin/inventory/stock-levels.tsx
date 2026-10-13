"use client";

import { AlertTriangle, Boxes, CheckCircle2, XCircle } from "lucide-react";
import * as React from "react";
import { DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Checkbox } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { formatDateTime, formatQty } from "@/lib/format";
import { LiveCount, RowMenu, STICKY_ACTIONS, ToneBadge, usePage } from "./form-kit";
import { AdjustDialog, ThresholdDialog, TransferDialog, WasteDialog, targetFromStock } from "./stock-dialogs";
import type { StockRow, StockStatus } from "./types";

const STATE: Record<StockStatus, { label: string; tone: "ok" | "warn" | "bad"; icon: typeof CheckCircle2 }> = {
  OK: { label: "Healthy", tone: "ok", icon: CheckCircle2 },
  LOW: { label: "Low", tone: "warn", icon: AlertTriangle },
  OUT: { label: "Out of stock", tone: "bad", icon: XCircle },
};

export function StockStateBadge({ status }: { status: StockStatus }) {
  const s = STATE[status] ?? STATE.OK;
  return <ToneBadge tone={s.tone} icon={s.icon}>{s.label}</ToneBadge>;
}

interface CategoryOption { id: number; name: string; parent: number | null }
const STATUS_OPTIONS: [string, string][] = [["low_or_out", "Low or out of stock"], ["low", "Low only"], ["out", "Out of stock"]];

type Dialog = { kind: "adjust" | "waste" | "transfer" | "thresholds"; row: StockRow } | null;

export function StockLevels({ initialLow = false }: { initialLow?: boolean }) {
  const { branchId, branchName, can } = useAdmin();
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search.trim());
  const [status, setStatus] = React.useState(initialLow ? "low_or_out" : "");
  const [category, setCategory] = React.useState("");
  const [batchOnly, setBatchOnly] = React.useState(false);
  const [ordering, setOrdering] = React.useState("product__name");
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [page, setPage] = usePage(JSON.stringify([q, status, category, batchOnly, ordering, branchId]));

  const cats = useAdminList<CategoryOption>("/categories/", { is_active: "true", page_size: 100 });
  const categoryOptions = React.useMemo<[string, string][]>(() => {
    const byId = new Map(cats.rows.map((c) => [c.id, c]));
    return cats.rows
      .map((c): [string, string, string] => [String(c.id), c.parent && byId.get(c.parent) ? `${byId.get(c.parent)!.name} › ${c.name}` : c.name, c.parent && byId.get(c.parent) ? `${byId.get(c.parent)!.name} ${c.name}` : c.name])
      .sort((a, b) => a[2].localeCompare(b[2]))
      .map(([v, l]) => [v, l]);
  }, [cats.rows]);

  const list = useAdminList<StockRow>("/inventory/stock/", {
    branch: branchId ?? undefined, search: q || undefined, category: category || undefined, status: status || undefined,
    tracks_batches: batchOnly ? "true" : undefined, ordering, page, page_size: 25,
  });

  const canAdjust = can("inventory.adjust"), canWaste = can("inventory.waste"), canTransfer = can("inventory.transfer");
  const hasActions = canAdjust || canWaste || canTransfer;
  const filtered = !!(q || status || category || batchOnly);

  // The content area is only ~950px wide on a 1280px screen, so the secondary columns appear on wider screens and the
  // store name rides under the product instead of taking a column of its own.
  const columns: Column<StockRow>[] = [
    { key: "product", header: "Product", sort: "product__name", cell: (r) => (
      <div className="min-w-44 max-sm:max-w-[14rem]">
        <p className="font-semibold text-ink">{r.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          <span>{r.sku}</span>
          {branchId === null && <span>· {r.branch}</span>}
          {r.tracks_batches && <ToneBadge tone="neutral" icon={Boxes}>Batch-tracked</ToneBadge>}
        </p>
        <p className="mt-0.5 text-xs text-ink-3 2xl:hidden">{r.category}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
          <StockStateBadge status={r.status} />
          <span className="num text-xs text-ink-2"><strong>{formatQty(r.available, r.unit)}</strong> available · {formatQty(r.on_hand, r.unit)} on hand</span>
        </div>
      </div>
    ) },
    { key: "category", header: "Category", className: "hidden 2xl:table-cell", cell: (r) => <span className="text-ink-2">{r.category}</span> },
    { key: "on_hand", header: "On hand", align: "right", sort: "on_hand", className: "hidden sm:table-cell", cell: (r) => <span className="whitespace-nowrap">{formatQty(r.on_hand, r.unit)}</span> },
    { key: "reserved", header: "Reserved", align: "right", className: "hidden xl:table-cell", cell: (r) => <span className="whitespace-nowrap text-ink-2">{formatQty(r.reserved, r.unit)}</span> },
    { key: "available", header: "Available", align: "right", sort: "free", className: "hidden sm:table-cell", cell: (r) => <strong className="whitespace-nowrap">{formatQty(r.available, r.unit)}</strong> },
    { key: "threshold", header: "Low-stock at", align: "right", className: "hidden xl:table-cell", cell: (r) => (Number(r.low_stock_threshold) > 0 ? <span className="whitespace-nowrap">{formatQty(r.low_stock_threshold, r.unit)}</span> : <span className="text-ink-3">Not set</span>) },
    { key: "status", header: "Status", className: "hidden sm:table-cell", cell: (r) => <StockStateBadge status={r.status} /> },
    { key: "moved", header: "Last movement", className: "hidden 2xl:table-cell", cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.last_movement_at ? formatDateTime(r.last_movement_at) : "Never"}</span> },
    ...(hasActions ? [{ key: "actions", header: "Actions", className: STICKY_ACTIONS, cell: (r: StockRow) => (
      <RowMenu label={`Actions for ${r.name}`} actions={[
        { label: "Adjust stock…", hidden: !canAdjust, onSelect: () => setDialog({ kind: "adjust", row: r }) },
        { label: "Record waste…", hidden: !canWaste, onSelect: () => setDialog({ kind: "waste", row: r }) },
        { label: "Transfer to another store…", hidden: !canTransfer, onSelect: () => setDialog({ kind: "transfer", row: r }) },
        { label: "Edit thresholds…", hidden: !canAdjust, onSelect: () => setDialog({ kind: "thresholds", row: r }) },
      ]} />
    ) }] : []),
  ];

  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search name or SKU…" label="Search stock" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} allLabel="All lines" />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={categoryOptions} allLabel="All categories" />
        <Checkbox label="Batch-tracked only" checked={batchOnly} onChange={(e) => setBatchOnly(e.target.checked)} className="items-center text-sm" />
      </FilterBar>
      <p className="text-sm text-ink-3">
        {branchId === null ? "Showing every store you can access." : <>Showing <strong className="text-ink-2">{branchName(branchId)}</strong>.</>} Change the store from the switcher at the top of the page.
        {initialLow && status === "low_or_out" && " This is the list behind the dashboard’s low-stock count; the dashboard only counts lines that have a low-stock threshold set, so this list can be slightly longer."}
      </p>
      <LiveCount count={list.count} noun="stock lines" loading={list.isLoading} />
      <DataTable<StockRow> caption="Stock levels by product and store" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        ordering={ordering} onOrdering={setOrdering}
        empty={<EmptyState icon={<Boxes className="size-7" aria-hidden />} title={filtered ? "No stock lines match" : "No stock lines yet"}>
          {filtered ? "Try clearing a filter or searching for something else." : "A line appears for each product and store once goods are received or stock is first adjusted."}
        </EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="stock lines" />

      {dialog?.kind === "adjust" && <AdjustDialog target={targetFromStock(dialog.row)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "waste" && <WasteDialog target={targetFromStock(dialog.row)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "transfer" && <TransferDialog target={targetFromStock(dialog.row)} onClose={() => setDialog(null)} />}
      {dialog?.kind === "thresholds" && <ThresholdDialog row={dialog.row} onClose={() => setDialog(null)} />}
    </div>
  );
}


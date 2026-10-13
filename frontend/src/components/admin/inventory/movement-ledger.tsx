"use client";

import { ArrowDownRight, ArrowUpRight, Lock, ScrollText } from "lucide-react";
import * as React from "react";
import { DataTable, Pager, humanise, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { formatDateTime, formatQty } from "@/lib/format";
import { LiveCount, ProductPicker, ToneBadge, usePage, type ProductOption } from "./form-kit";
import { signed } from "./stock-math";
import { MOVEMENT_KINDS, type MovementRow } from "./types";

const KIND_TONE: Record<string, "ok" | "bad" | "info" | "warn" | "neutral"> = {
  RECEIPT: "ok", RETURN: "ok", TRANSFER_IN: "info", SALE: "neutral", ADJUSTMENT: "warn", WASTE: "bad", TRANSFER_OUT: "info",
};

function ChangeText({ m }: { m: MovementRow }) {
  const neg = m.qty_delta.startsWith("-");
  const Icon = neg ? ArrowDownRight : ArrowUpRight;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap font-semibold ${neg ? "text-bad" : "text-ok"}`}><Icon className="size-3.5" aria-hidden />{signed(m.qty_delta)}</span>;
}

/** Read-only view of the immutable stock ledger. There is deliberately no edit or delete anywhere in here. */
export function MovementLedger() {
  const { branchId, branchName } = useAdmin();
  const [product, setProduct] = React.useState<ProductOption | null>(null);
  const [kind, setKind] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search.trim());
  const rangeError = from && to && from > to ? "The start date is after the end date." : undefined;
  const [page, setPage] = usePage(JSON.stringify([product?.id, kind, from, to, q, branchId]));

  const list = useAdminList<MovementRow>("/inventory/movements/", {
    branch: branchId ?? undefined, product: product?.id, kind: kind || undefined, date_from: rangeError ? undefined : from || undefined,
    date_to: rangeError ? undefined : to || undefined, search: q || undefined, page, page_size: 30,
  }, { enabled: !rangeError });
  const filtered = !!(product || kind || from || to || q);

  const columns: Column<MovementRow>[] = [
    { key: "at", header: "When", className: "hidden sm:table-cell", cell: (m) => <span className="whitespace-nowrap">{formatDateTime(m.at)}</span> },
    { key: "product", header: "Product", cell: (m) => (
      <div className="min-w-40 max-sm:max-w-[14rem]">
        <p className="font-semibold text-ink">{m.name}</p>
        <p className="text-xs text-ink-3">{m.sku}{branchId === null ? ` · ${m.branch}` : ""}</p>
        <div className="mt-1.5 space-y-1 sm:hidden">
          <div className="flex flex-wrap items-center gap-2"><ToneBadge tone={KIND_TONE[m.kind] ?? "neutral"}>{m.kind_label}</ToneBadge><ChangeText m={m} /></div>
          <p className="text-xs text-ink-2">{formatDateTime(m.at)}</p>
        </div>
      </div>
    ) },
    { key: "kind", header: "Kind", className: "hidden sm:table-cell", cell: (m) => <ToneBadge tone={KIND_TONE[m.kind] ?? "neutral"}>{m.kind_label}</ToneBadge> },
    { key: "delta", header: "Change", align: "right", className: "hidden sm:table-cell", cell: (m) => <ChangeText m={m} /> },
    { key: "after", header: "On hand after", align: "right", className: "hidden sm:table-cell", cell: (m) => formatQty(m.on_hand_after) },
    { key: "why", header: "Details", className: "hidden md:table-cell", cell: (m) => (
      <div className="max-w-72 space-y-0.5 text-ink-2">
        {m.reason && m.reason !== m.kind && <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{humanise(m.reason)}</p>}
        {m.note && <p className="break-words">{m.note}</p>}
        <p className="text-xs text-ink-3">
          {m.lot && <span className="whitespace-nowrap">Lot {m.lot}</span>}{m.lot && " · "}by {m.by}{m.ref ? ` · ${m.ref}` : ""}
        </p>
      </div>
    ) },
  ];

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm text-ink-2">
        <Lock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
        <span>The ledger is append-only: movements can’t be edited or deleted. A mistake is corrected with a new adjustment, which appears here as its own line. {branchId === null ? "Showing every store you can access." : <>Showing <strong>{branchName(branchId)}</strong>.</>}</span>
      </p>
      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,1.4fr)_minmax(9rem,1fr)_9rem_9rem_minmax(12rem,1fr)]" role="search">
        <ProductPicker id="ledger-product" label="Product" value={product} onChange={setProduct} onlyActive={false} hint="Leave empty for all products." />
        <Field label="Kind" htmlFor="ledger-kind">
          <Select id="ledger-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {MOVEMENT_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="From" htmlFor="ledger-from"><Input id="ledger-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To" htmlFor="ledger-to" error={rangeError}><Input id="ledger-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Search" htmlFor="ledger-search" hint="Lot code, reference or product name.">
          <Input id="ledger-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the ledger…" />
        </Field>
      </div>
      {filtered && <div><Button variant="ghost" size="sm" onClick={() => { setProduct(null); setKind(""); setFrom(""); setTo(""); setSearch(""); }}>Clear filters</Button></div>}
      <LiveCount count={list.count} noun="movements" loading={list.isLoading} />
      <DataTable<MovementRow> caption="Stock movement ledger, newest first" columns={columns} rows={rangeError ? [] : list.rows} loading={!rangeError && list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState icon={<ScrollText className="size-7" aria-hidden />} title={filtered ? "No movements match" : "No movements yet"}>{filtered ? "Try widening the dates or clearing a filter." : "Receipts, sales, adjustments, waste and transfers all appear here."}</EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="movements" />
    </div>
  );
}

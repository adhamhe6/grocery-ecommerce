"use client";

import { AlertTriangle, MessageCircleQuestion, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AdminPage, DataTable, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { useMoney } from "@/lib/hooks";
import { OPEN_STATUSES, ORDER_STATUS_OPTIONS, PAYMENT_STATUS_OPTIONS } from "./actions";
import { FilterField, FulfilmentLabel, OrderStatusBadge, PaymentBadge, useUrlParams, useZoneFormat } from "./shared";
import type { OrderRow } from "./types";

const STATUS_FILTER_OPTIONS: [string, string][] = [["open", "Open orders"], ...ORDER_STATUS_OPTIONS];
const TYPE_OPTIONS: [string, string][] = [["DELIVERY", "Delivery"], ["PICKUP", "Pickup"]];
const REFRESH_MS = 30_000;

export function OrdersListPage() {
  return <RequireCapability any={["orders.read"]}><OrdersListInner /></RequireCapability>;
}

function OrdersListInner() {
  const { branchId } = useAdmin();
  const money = useMoney();
  const f = useZoneFormat();
  const router = useRouter();
  const url = useUrlParams();

  // The dashboard links here with ?open=1: the API has no such flag, so it is the list of open statuses.
  const status = url.get("status") || (url.get("open") === "1" ? "open" : "");
  const type = url.get("type");
  const payment = url.get("payment");
  const from = url.get("from");
  const to = url.get("to");
  const slotDate = url.get("slot");
  const attention = url.get("attention") === "1";
  const mine = url.get("mine") === "1";
  const ordering = url.get("ordering") || "-placed_at";
  const page = Number(url.get("page")) || 1;

  const [text, setText] = React.useState(url.get("search"));
  const search = useDebouncedValue(text.trim());
  React.useEffect(() => {
    if (search !== url.get("search")) url.set({ search });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [search]);

  const list = useAdminList<OrderRow>("/orders/", {
    status: status === "open" ? OPEN_STATUSES.join(",") : status || undefined,
    fulfilment_type: type || undefined,
    payment_status: payment || undefined,
    placed_from: from || undefined,
    placed_to: to || undefined,
    slot_date: slotDate || undefined,
    needs_attention: attention ? "true" : undefined,
    mine: mine ? "true" : undefined,
    search: search || undefined,
    branch: branchId ?? undefined,
    ordering,
    page,
  }, { refetchInterval: REFRESH_MS });

  const [updatedAt, setUpdatedAt] = React.useState<Date | null>(null);
  React.useEffect(() => { if (!list.isFetching && !list.error) setUpdatedAt(new Date()); }, [list.isFetching, list.error]);

  const filtersActive = !!(status || type || payment || from || to || slotDate || attention || mine || text);
  const clear = () => { setText(""); url.set({ status: null, open: null, type: null, payment: null, from: null, to: null, slot: null, attention: null, mine: null, search: null }); };

  const columns: Column<OrderRow>[] = [
    {
      key: "number", header: "Order", cell: (o) => (
        <div>
          <Link href={`/admin/orders/${encodeURIComponent(o.number)}`} className="whitespace-nowrap font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{o.number}</Link>
          <p className="text-xs text-ink-2 md:hidden">{o.customer} · {money(o.final_total ?? o.total)}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
            {o.is_late && <span className="inline-flex items-center gap-1 font-semibold text-bad"><AlertTriangle className="size-3" aria-hidden />Late</span>}
            {o.awaiting_customer && <span className="inline-flex items-center gap-1 font-semibold text-warn"><MessageCircleQuestion className="size-3" aria-hidden />Awaiting customer</span>}
          </div>
        </div>
      ),
    },
    { key: "placed", header: "Placed", sort: "placed_at", className: "hidden whitespace-nowrap xl:table-cell", cell: (o) => f.dateTime(o.placed_at) },
    { key: "customer", header: "Customer", hideBelow: "md", cell: (o) => <span>{o.customer}{o.is_guest && <span className="ml-1.5 text-xs text-ink-3">guest</span>}</span> },
    { key: "store", header: "Store", className: "hidden xl:table-cell", cell: (o) => o.branch },
    { key: "type", header: "Type", className: "hidden xl:table-cell", cell: (o) => <FulfilmentLabel type={o.fulfilment_type} /> },
    {
      key: "slot", header: "Slot", sort: "slot_starts_at", hideBelow: "lg", className: "whitespace-nowrap",
      cell: (o) => (o.slot_starts_at && o.slot_ends_at
        ? <span className="flex items-start gap-1.5"><FulfilmentLabel type={o.fulfilment_type} iconOnly className="mt-0.5 xl:hidden" /><span>{f.slotDay(o.slot_starts_at)}<span className="block text-xs text-ink-3">{f.slotWindow(o.slot_starts_at, o.slot_ends_at)}</span></span></span>
        : <span className="text-ink-3">—</span>),
    },
    { key: "status", header: "Status", sort: "status", cell: (o) => <OrderStatusBadge status={o.status} label={o.status_label} /> },
    { key: "payment", header: "Payment", hideBelow: "sm", cell: (o) => <div className="space-y-0.5"><PaymentBadge status={o.payment_status} short /><span className="block text-xs text-ink-3">{o.payment_method === "COD" ? "Cash" : "Card"}</span></div> },
    { key: "total", header: "Total", sort: "total", align: "right", cell: (o) => <span>{money(o.final_total ?? o.total)}{o.final_total === null && <span className="block text-xs text-ink-3">estimate</span>}</span> },
  ];

  return (
    <AdminPage title="Orders" description="Every order for the selected store. The list refreshes itself every 30 seconds."
      actions={<span className="text-sm text-ink-3" role="status">{list.isFetching ? "Refreshing…" : updatedAt ? `Updated ${f.time(updatedAt.toISOString())}` : ""}</span>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <div className="col-span-full"><SearchField value={text} onChange={setText} label="Search orders" placeholder="Order number, name, email or phone" /></div>
          <FilterField label="Status" className="col-span-2 sm:col-span-1"><Select className="h-10 text-sm" value={status} onChange={(e) => url.set({ status: e.target.value, open: null })}><option value="">All statuses</option>{STATUS_FILTER_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FilterField>
          <FilterField label="Type"><Select className="h-10 text-sm" value={type} onChange={(e) => url.set({ type: e.target.value })}><option value="">All types</option>{TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FilterField>
          <FilterField label="Payment"><Select className="h-10 text-sm" value={payment} onChange={(e) => url.set({ payment: e.target.value })}><option value="">All payments</option>{PAYMENT_STATUS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FilterField>
          <FilterField label="Placed from"><Input type="date" className="h-10 text-sm" value={from} max={to || undefined} onChange={(e) => url.set({ from: e.target.value })} /></FilterField>
          <FilterField label="Placed to"><Input type="date" className="h-10 text-sm" value={to} min={from || undefined} onChange={(e) => url.set({ to: e.target.value })} /></FilterField>
          <FilterField label="Slot date"><Input type="date" className="h-10 text-sm" value={slotDate} onChange={(e) => url.set({ slot: e.target.value })} /></FilterField>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Checkbox className="text-sm" label="Needs attention" checked={attention} onChange={(e) => url.set({ attention: e.target.checked ? "1" : null })} />
          <Checkbox className="text-sm" label="Assigned to me" checked={mine} onChange={(e) => url.set({ mine: e.target.checked ? "1" : null })} />
          {filtersActive && <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button>}
          <Button variant="secondary" size="sm" className="ml-auto" onClick={() => list.refetch()} loading={list.isFetching}><RefreshCw className="size-4" aria-hidden />Refresh</Button>
        </div>
        {status === "open" && <p className="text-sm text-ink-2">Open orders are accepted but not yet completed: confirmed, picking, packing, ready, or out for delivery.</p>}
        {attention && <p className="text-sm text-ink-2">“Needs attention” shows orders waiting on a customer&apos;s substitution answer or with a failed payment.</p>}

        <DataTable caption="Orders" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
          ordering={ordering} onOrdering={(o) => url.set({ ordering: o })} rowKey={(o) => o.number} onRowClick={(o) => router.push(`/admin/orders/${encodeURIComponent(o.number)}`)}
          empty={<EmptyState title={filtersActive ? "No orders match these filters" : "No orders yet"} action={filtersActive ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : undefined}>{filtersActive ? "Try widening the date range or removing a filter." : "Orders appear here as soon as customers check out."}</EmptyState>} />
        {!list.isLoading && !list.error && <Pager page={list.page} totalPages={list.totalPages} count={list.count} label={list.count === 1 ? "order" : "orders"} onPage={(p) => url.set({ page: String(p) })} />}
      </div>
    </AdminPage>
  );
}

"use client";

import { Plus, Receipt } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { LiveCount, usePage } from "@/components/admin/inventory/form-kit";
import { AdminPage, DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { PoStatusBadge } from "./badges";
import { PO_STATUSES, type PurchaseOrderRow } from "./types";

const STATUS_FILTERS: [string, string][] = [["outstanding", "Awaiting delivery"], ...PO_STATUSES];

export function PurchaseOrderList() {
  return <RequireCapability any={["purchasing.read"]}><PurchaseOrderListInner /></RequireCapability>;
}

function PurchaseOrderListInner() {
  const { branchId, can } = useAdmin();
  const money = useMoney();
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search.trim());
  const [status, setStatus] = React.useState("");
  const [page, setPage] = usePage(JSON.stringify([q, status, branchId]));
  const list = useAdminList<PurchaseOrderRow>("/purchase-orders/", {
    branch: branchId ?? undefined, search: q || undefined, status: status && status !== "outstanding" ? status : undefined,
    outstanding: status === "outstanding" ? "true" : undefined, page, page_size: 25,
  });

  const columns: Column<PurchaseOrderRow>[] = [
    { key: "number", header: "Order", cell: (p) => (
      <div className="max-sm:max-w-[14rem]">
        <Link href={`/admin/purchase-orders/${p.id}`} className="whitespace-nowrap font-semibold text-primary underline-offset-4 hover:underline">{p.number}</Link>
        <div className="mt-1.5 space-y-1 sm:hidden">
          <p className="text-xs text-ink-2">{p.supplier}</p>
          <PoStatusBadge status={p.status} />
          <p className="num text-xs font-semibold">{money(p.total_cost)}</p>
        </div>
      </div>
    ) },
    { key: "supplier", header: "Supplier", className: "hidden sm:table-cell", cell: (p) => <Link href={`/admin/suppliers/${p.supplier_id}`} className="underline-offset-4 hover:underline">{p.supplier}</Link> },
    ...(branchId === null ? [{ key: "store", header: "Delivering to", hideBelow: "md" as const, cell: (p: PurchaseOrderRow) => p.branch }] : []),
    { key: "status", header: "Status", className: "hidden sm:table-cell", cell: (p) => <PoStatusBadge status={p.status} /> },
    { key: "expected", header: "Expected", className: "hidden md:table-cell", cell: (p) => <span className="whitespace-nowrap">{formatDate(p.expected_date)}</span> },
    { key: "lines", header: "Lines", align: "right", hideBelow: "md", cell: (p) => p.line_count },
    { key: "total", header: "Total", align: "right", className: "hidden sm:table-cell", cell: (p) => money(p.total_cost) },
    { key: "created", header: "Created", hideBelow: "lg", cell: (p) => <span className="whitespace-nowrap text-ink-2">{formatDate(p.created_at)}</span> },
  ];

  return (
    <AdminPage title="Purchase orders" description="Orders placed with suppliers, from draft to delivered. Open an order to submit it, record a delivery or cancel it."
      actions={can("purchasing.write") ? <ButtonLink href="/admin/purchase-orders/new"><Plus className="size-4" aria-hidden /> New purchase order</ButtonLink> : undefined}>
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Order number or supplier…" label="Search purchase orders" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_FILTERS} allLabel="All orders" />
      </FilterBar>
      <LiveCount count={list.count} noun="purchase orders" loading={list.isLoading} />
      <DataTable<PurchaseOrderRow> caption="Purchase orders, newest first" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState icon={<Receipt className="size-7" aria-hidden />} title={q || status ? "No purchase orders match" : "No purchase orders yet"}
          action={can("purchasing.write") && !q && !status ? <ButtonLink href="/admin/purchase-orders/new">Create the first order</ButtonLink> : undefined}>
          {q || status ? "Try clearing a filter." : "Create an order to restock from a supplier."}
        </EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="purchase orders" />
    </AdminPage>
  );
}

"use client";

import { ArrowLeft, Pencil, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { usePage } from "@/components/admin/inventory/form-kit";
import { AdminPage, Card, DataTable, KeyValue, Pager, type Column } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { useAdmin, useAdminGet, useAdminList } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { PoStatusBadge, SupplierStatusBadge } from "./badges";
import { SupplierCatalogue } from "./supplier-catalogue";
import { SupplierDialog } from "./supplier-form";
import { SupplierPerformanceCard } from "./supplier-performance";
import type { PurchaseOrderRow, Supplier } from "./types";

export function SupplierDetail({ id }: { id: number }) {
  return <RequireCapability any={["purchasing.read"]}><SupplierDetailInner id={id} /></RequireCapability>;
}

function SupplierDetailInner({ id }: { id: number }) {
  const { can } = useAdmin();
  const router = useRouter();
  const q = useAdminGet<Supplier>(`/suppliers/${id}/`);
  const [editing, setEditing] = React.useState(false);

  if (q.error) return <AdminPage title="Supplier"><ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load this supplier" /></AdminPage>;
  const s = q.data;
  if (!s) return <AdminPage title="Supplier"><div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-40 w-full" /></div></AdminPage>;

  return (
    <AdminPage title={s.name} description={<span className="inline-flex flex-wrap items-center gap-2">Supplier code {s.code} <SupplierStatusBadge status={s.status} /></span>}
      actions={
        <>
          <ButtonLink href="/admin/suppliers" variant="ghost" size="sm"><ArrowLeft className="size-4" aria-hidden /> All suppliers</ButtonLink>
          {can("purchasing.write") && <Button variant="secondary" size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden /> Edit</Button>}
          {can("purchasing.write") && s.status === "ACTIVE" && <ButtonLink href={`/admin/purchase-orders/new?supplier=${s.id}`} size="sm"><Plus className="size-4" aria-hidden /> New purchase order</ButtonLink>}
        </>
      }>
      <Card title="Contact and terms">
        <KeyValue columns={3} items={[
          ["Contact", s.contact_name || "—"],
          ["Email", s.email ? <a className="break-all underline underline-offset-2" href={`mailto:${s.email}`}>{s.email}</a> : "—"],
          ["Phone", s.phone || "—"],
          ["Lead time", `${s.lead_time_days} ${s.lead_time_days === 1 ? "day" : "days"}`],
          ["Products linked", s.product_count],
          ["Address", s.address ? <span className="whitespace-pre-line">{s.address}</span> : "—"],
          ["Notes", s.notes ? <span className="whitespace-pre-line">{s.notes}</span> : "—"],
        ]} />
      </Card>
      <SupplierPerformanceCard supplierId={s.id} />
      <SupplierOrders supplierId={s.id} />
      <SupplierCatalogue supplierId={s.id} />
      {editing && <SupplierDialog supplier={s} onClose={() => setEditing(false)} onDeleted={() => router.replace("/admin/suppliers")} />}
    </AdminPage>
  );
}

function SupplierOrders({ supplierId }: { supplierId: number }) {
  const money = useMoney();
  const [page, setPage] = usePage(String(supplierId));
  const list = useAdminList<PurchaseOrderRow>("/purchase-orders/", { supplier: supplierId, page, page_size: 10 });
  const columns: Column<PurchaseOrderRow>[] = [
    { key: "number", header: "Order", cell: (p) => (
      <div>
        <Link href={`/admin/purchase-orders/${p.id}`} className="whitespace-nowrap font-semibold text-primary underline-offset-4 hover:underline">{p.number}</Link>
        <div className="mt-1.5 space-y-1 sm:hidden"><PoStatusBadge status={p.status} /><p className="num text-xs font-semibold">{money(p.total_cost)}</p></div>
      </div>
    ) },
    { key: "store", header: "Store", className: "hidden md:table-cell", cell: (p) => p.branch },
    { key: "status", header: "Status", className: "hidden sm:table-cell", cell: (p) => <PoStatusBadge status={p.status} /> },
    { key: "expected", header: "Expected", className: "hidden md:table-cell", cell: (p) => formatDate(p.expected_date) },
    { key: "total", header: "Total", align: "right", className: "hidden sm:table-cell", cell: (p) => money(p.total_cost) },
  ];
  return (
    <Card title="Purchase orders" padded={false}>
      <div className="space-y-3 p-4 sm:p-5">
        <DataTable<PurchaseOrderRow> caption="Purchase orders for this supplier, newest first" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
          empty={<EmptyState icon={<Receipt className="size-7" aria-hidden />} title="No purchase orders yet">Orders raised against this supplier will be listed here.</EmptyState>} />
        <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="orders" />
      </div>
    </Card>
  );
}

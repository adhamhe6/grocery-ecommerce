"use client";

import { Plus, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { LiveCount, RowMenu, STICKY_ACTIONS, usePage } from "@/components/admin/inventory/form-kit";
import { AdminPage, DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { SupplierStatusBadge } from "./badges";
import { SupplierDialog } from "./supplier-form";
import { SUPPLIER_STATUSES, type Supplier } from "./types";

export function SuppliersList() {
  return <RequireCapability any={["purchasing.read"]}><SuppliersListInner /></RequireCapability>;
}

function SuppliersListInner() {
  const { can } = useAdmin();
  const router = useRouter();
  const canWrite = can("purchasing.write");
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search.trim());
  const [status, setStatus] = React.useState("");
  const [dialog, setDialog] = React.useState<{ supplier?: Supplier } | null>(null);
  const [page, setPage] = usePage(JSON.stringify([q, status]));
  const list = useAdminList<Supplier>("/suppliers/", { search: q || undefined, status: status || undefined, page, page_size: 25 });

  const columns: Column<Supplier>[] = [
    { key: "name", header: "Supplier", cell: (s) => (
      <div className="min-w-40 max-sm:max-w-[14rem]">
        <Link href={`/admin/suppliers/${s.id}`} className="font-semibold text-primary underline-offset-4 hover:underline">{s.name}</Link>
        <p className="text-xs text-ink-3">{s.code} · {s.lead_time_days} {s.lead_time_days === 1 ? "day" : "days"} lead time</p>
        <div className="mt-1.5 sm:hidden"><SupplierStatusBadge status={s.status} /></div>
      </div>
    ) },
    { key: "contact", header: "Contact", hideBelow: "md", cell: (s) => (
      <div className="text-ink-2">
        <p>{s.contact_name || "—"}</p>
        {s.email && <p className="break-all text-xs">{s.email}</p>}
        {s.phone && <p className="text-xs">{s.phone}</p>}
      </div>
    ) },
    { key: "lead", header: "Lead time", align: "right", hideBelow: "sm", cell: (s) => `${s.lead_time_days} ${s.lead_time_days === 1 ? "day" : "days"}` },
    { key: "products", header: "Products", align: "right", hideBelow: "sm", cell: (s) => s.product_count },
    { key: "status", header: "Status", className: "hidden sm:table-cell", cell: (s) => <SupplierStatusBadge status={s.status} /> },
    { key: "actions", header: "Actions", className: STICKY_ACTIONS, cell: (s) => (
      <RowMenu label={`Actions for ${s.name}`} actions={[
        { label: "Open details", onSelect: () => router.push(`/admin/suppliers/${s.id}`) },
        { label: "Edit supplier…", hidden: !canWrite, onSelect: () => setDialog({ supplier: s }) },
      ]} />
    ) },
  ];

  return (
    <AdminPage title="Suppliers" description="Who you buy from, how quickly they deliver and how they perform against the orders you place."
      actions={canWrite ? <Button onClick={() => setDialog({})}><Plus className="size-4" aria-hidden /> New supplier</Button> : undefined}>
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Name, code, contact or email…" label="Search suppliers" />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={SUPPLIER_STATUSES} allLabel="Any status" />
      </FilterBar>
      <LiveCount count={list.count} noun="suppliers" loading={list.isLoading} />
      <DataTable<Supplier> caption="Suppliers" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState icon={<Store className="size-7" aria-hidden />} title={q || status ? "No suppliers match" : "No suppliers yet"}
          action={canWrite && !q && !status ? <Button onClick={() => setDialog({})}>Add the first supplier</Button> : undefined}>
          {q || status ? "Try clearing a filter." : "Add the suppliers you buy from, then raise purchase orders against them."}
        </EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="suppliers" />
      {dialog && <SupplierDialog supplier={dialog.supplier} onClose={() => setDialog(null)} />}
    </AdminPage>
  );
}

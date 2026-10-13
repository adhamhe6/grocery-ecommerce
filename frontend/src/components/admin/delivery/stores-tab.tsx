"use client";

import { CheckCircle2, Plus, Truck, ShoppingBag, XCircle } from "lucide-react";
import * as React from "react";
import { LiveCount, RowMenu, STICKY_ACTIONS, ToneBadge } from "@/components/admin/inventory/form-kit";
import { DataTable, type Column } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { BranchDialog } from "./branch-form";
import type { Branch } from "./types";

function Services({ b }: { b: Branch }) {
  return (
    <div className="flex flex-wrap gap-1">
      {b.offers_delivery ? <ToneBadge tone="ok" icon={Truck}>Delivery</ToneBadge> : <ToneBadge tone="neutral">No delivery</ToneBadge>}
      {b.offers_pickup ? <ToneBadge tone="ok" icon={ShoppingBag}>Pickup</ToneBadge> : <ToneBadge tone="neutral">No pickup</ToneBadge>}
    </div>
  );
}

function Status({ b }: { b: Branch }) {
  return b.is_active ? <ToneBadge tone="ok" icon={CheckCircle2}>Active</ToneBadge> : <ToneBadge tone="neutral" icon={XCircle}>Inactive</ToneBadge>;
}

export function StoresTab() {
  const { can } = useAdmin();
  const canManage = can("branches.manage");
  const list = useAdminList<Branch>("/branches/");
  const [dialog, setDialog] = React.useState<{ branch?: Branch } | null>(null);

  const columns: Column<Branch>[] = [
    { key: "name", header: "Store", cell: (b) => (
      <div className="min-w-40 max-sm:max-w-[14rem]">
        <p className="font-semibold text-ink">{b.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3"><span>{b.code}</span>{b.is_default && <ToneBadge tone="info">Default store</ToneBadge>}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1 sm:hidden"><Services b={b} /><Status b={b} /></div>
      </div>
    ) },
    { key: "address", header: "Address", hideBelow: "md", cell: (b) => <span className="text-ink-2">{[b.address_line1, b.address_line2, b.area, b.city, b.postal_code].filter(Boolean).join(", ")}</span> },
    { key: "contact", header: "Contact", hideBelow: "lg", cell: (b) => <div className="text-ink-2"><p>{b.phone || "—"}</p>{b.email && <p className="break-all text-xs">{b.email}</p>}</div> },
    { key: "services", header: "Services", className: "hidden sm:table-cell", cell: (b) => <Services b={b} /> },
    { key: "prep", header: "Prep time", align: "right", hideBelow: "sm", cell: (b) => `${b.prep_minutes} min` },
    { key: "status", header: "Status", className: "hidden sm:table-cell", cell: (b) => <Status b={b} /> },
    ...(canManage ? [{ key: "actions", header: "Actions", className: STICKY_ACTIONS, cell: (b: Branch) => <RowMenu label={`Actions for ${b.name}`} actions={[{ label: "Edit store…", onSelect: () => setDialog({ branch: b }) }]} /> }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-2">The stores customers can order from or collect at. Opening hours, closures and delivery zones are on the other tabs.{!canManage && " Your role can view stores but not change them."}</p>
        {canManage && <Button onClick={() => setDialog({})}><Plus className="size-4" aria-hidden /> New store</Button>}
      </div>
      <LiveCount count={list.count} noun="stores" loading={list.isLoading} />
      <DataTable<Branch> caption="Stores" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState title="No stores yet" action={canManage ? <Button onClick={() => setDialog({})}>Add the first store</Button> : undefined}>Add a store to start taking orders.</EmptyState>} />
      {dialog && <BranchDialog branch={dialog.branch} onClose={() => setDialog(null)} />}
    </div>
  );
}

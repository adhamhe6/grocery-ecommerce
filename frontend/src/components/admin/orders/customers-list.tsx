"use client";

import { BellOff, BellRing } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AdminPage, DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdminList } from "@/lib/admin";
import { useMoney } from "@/lib/hooks";
import { useUrlParams, useZoneFormat } from "./shared";
import type { CustomerRow } from "./types";

export function MarketingBadge({ optedIn }: { optedIn: boolean }) {
  return optedIn
    ? <Badge tone="ok"><BellRing className="size-3" aria-hidden />Subscribed</Badge>
    : <Badge tone="neutral"><BellOff className="size-3" aria-hidden />Not subscribed</Badge>;
}

export function AccountBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? "ok" : "bad"}>{active ? "Active" : "Deactivated"}</Badge>;
}

export function CustomersListPage() {
  return <RequireCapability any={["customers.read"]}><CustomersListInner /></RequireCapability>;
}

function CustomersListInner() {
  const money = useMoney();
  const f = useZoneFormat();
  const router = useRouter();
  const url = useUrlParams();
  const active = url.get("active");
  const ordered = url.get("ordered");
  const ordering = url.get("ordering") || "-created_at";
  const page = Number(url.get("page")) || 1;
  const [text, setText] = React.useState(url.get("search"));
  const search = useDebouncedValue(text.trim());
  React.useEffect(() => {
    if (search !== url.get("search")) url.set({ search });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced text
  }, [search]);

  const list = useAdminList<CustomerRow>("/customers/", { search: search || undefined, is_active: active || undefined, has_orders: ordered || undefined, ordering, page });
  const filtersActive = !!(active || ordered || text);
  const clear = () => { setText(""); url.set({ active: null, ordered: null, search: null }); };

  const columns: Column<CustomerRow>[] = [
    {
      key: "name", header: "Customer", sort: "full_name",
      cell: (c) => <div><Link href={`/admin/customers/${c.id}`} className="font-semibold text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{c.full_name || c.email}</Link><p className="text-xs text-ink-3">{c.email}</p></div>,
    },
    { key: "phone", header: "Phone", className: "hidden whitespace-nowrap xl:table-cell", cell: (c) => c.phone || <span className="text-ink-3">—</span> },
    { key: "marketing", header: "Marketing emails", hideBelow: "md", cell: (c) => <MarketingBadge optedIn={c.marketing_opt_in} /> },
    { key: "orders", header: "Orders", sort: "orders_count", align: "right", cell: (c) => c.orders_count },
    { key: "spend", header: "Lifetime spend", sort: "lifetime_spend", align: "right", cell: (c) => money(c.lifetime_spend) },
    { key: "last", header: "Last order", sort: "last_order_at", className: "hidden whitespace-nowrap xl:table-cell", cell: (c) => (c.last_order_at ? f.date(c.last_order_at) : <span className="text-ink-3">Never</span>) },
    { key: "joined", header: "Joined", sort: "created_at", className: "hidden whitespace-nowrap xl:table-cell", cell: (c) => f.date(c.joined_at) },
    { key: "status", header: "Account", cell: (c) => <AccountBadge active={c.is_active} /> },
  ];

  return (
    <AdminPage title="Customers" description="Registered customer accounts. Store staff only see customers who have ordered at their store. Lifetime spend counts completed orders at their final total.">
      <div className="space-y-4">
        <FilterBar>
          <SearchField value={text} onChange={setText} label="Search customers" placeholder="Name, email or phone" />
          <FilterSelect label="Account" value={active} onChange={(v) => url.set({ active: v })} options={[["true", "Active"], ["false", "Deactivated"]]} />
          <FilterSelect label="Orders" value={ordered} onChange={(v) => url.set({ ordered: v })} options={[["true", "Has ordered"], ["false", "Never ordered"]]} />
          {filtersActive && <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button>}
        </FilterBar>
        <DataTable caption="Customers" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} ordering={ordering} onOrdering={(o) => url.set({ ordering: o })}
          onRowClick={(c) => router.push(`/admin/customers/${c.id}`)}
          empty={<EmptyState title={filtersActive ? "No customers match" : "No customers yet"}>{filtersActive ? "Try a different search or clear the filters." : "Customers appear here once they have placed an order."}</EmptyState>} />
        {!list.isLoading && !list.error && <Pager page={list.page} totalPages={list.totalPages} count={list.count} label={list.count === 1 ? "customer" : "customers"} onPage={(p) => url.set({ page: String(p) })} />}
      </div>
    </AdminPage>
  );
}

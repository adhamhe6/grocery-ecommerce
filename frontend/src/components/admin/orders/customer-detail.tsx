"use client";

import { Mail, Phone } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AdminPage, Card, ConfirmDialog, DataTable, KeyValue, StatusBadge, type Column } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { adminRequest, useAdmin, useAdminAction, useAdminGet } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { useMoney } from "@/lib/hooks";
import { CASE_KIND_OPTIONS, CASE_STATUS_LABELS, RESOLUTION_LABELS } from "./cases-list";
import { AccountBadge, MarketingBadge } from "./customers-list";
import { parseMoney } from "./decimal";
import { BackLink, ErrorAlert, FulfilmentLabel, OrderStatusBadge, useZoneFormat } from "./shared";
import type { CustomerDetail } from "./types";

const KIND_LABELS = Object.fromEntries(CASE_KIND_OPTIONS);
const DETAIL_LIMIT = 50; // the API returns at most this many orders / cases

export function CustomerDetailPage({ id }: { id: string }) {
  return <RequireCapability any={["customers.read"]}><CustomerDetailInner id={id} /></RequireCapability>;
}

function CustomerDetailInner({ id }: { id: string }) {
  const { can } = useAdmin();
  const money = useMoney();
  const f = useZoneFormat();
  const path = `/customers/${encodeURIComponent(id)}/`;
  const q = useAdminGet<CustomerDetail>(path);
  const [confirming, setConfirming] = React.useState(false);
  const toggle = useAdminAction((active: boolean) => adminRequest<CustomerDetail>("PATCH", path, { is_active: active }), {
    invalidate: ["/customers"], success: (d) => (d.is_active ? "Account reactivated" : "Account deactivated"), onSuccess: () => setConfirming(false),
  });
  const c = q.data;

  if (q.error && !c) return <AdminPage title="Customer"><BackLink href="/admin/customers">All customers</BackLink><ErrorState error={q.error} onRetry={() => q.refetch()} title={q.error instanceof ApiError && q.error.status === 404 ? "We couldn't find that customer" : "We couldn't load this customer"} /></AdminPage>;
  if (!c) return <AdminPage title="Customer"><div aria-busy="true" className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div></AdminPage>;

  const orderColumns: Column<CustomerDetail["orders"][number] & { id?: undefined }>[] = [
    { key: "number", header: "Order", cell: (o) => <Link className="font-semibold text-primary hover:underline" href={`/admin/orders/${encodeURIComponent(o.number)}`}>{o.number}</Link> },
    { key: "placed", header: "Placed", className: "whitespace-nowrap", hideBelow: "sm", cell: (o) => f.dateTime(o.placed_at) },
    { key: "type", header: "Type", hideBelow: "md", cell: (o) => <FulfilmentLabel type={o.fulfilment_type} /> },
    { key: "store", header: "Store", hideBelow: "md", cell: (o) => o.branch },
    { key: "status", header: "Status", cell: (o) => <OrderStatusBadge status={o.status} /> },
    { key: "total", header: "Total", align: "right", cell: (o) => money(o.final_total ?? o.total) },
  ];
  const caseColumns: Column<CustomerDetail["cases"][number]>[] = [
    { key: "id", header: "Case", cell: (k) => (can("support.manage") ? <Link className="font-semibold text-primary hover:underline" href={`/admin/cases/${k.id}`}>#{k.id}</Link> : <span className="font-semibold">#{k.id}</span>) },
    { key: "order", header: "Order", cell: (k) => <Link className="text-primary hover:underline" href={`/admin/orders/${encodeURIComponent(k.order_number)}`}>{k.order_number}</Link> },
    { key: "kind", header: "Problem", cell: (k) => KIND_LABELS[k.kind] ?? k.kind },
    { key: "status", header: "Status", cell: (k) => <StatusBadge status={k.status} label={CASE_STATUS_LABELS[k.status]} /> },
    { key: "outcome", header: "Outcome", hideBelow: "sm", cell: (k) => (k.status === "RESOLVED" ? `${RESOLUTION_LABELS[k.resolution]}${(parseMoney(k.refund_amount) ?? 0n) > 0n ? ` · ${money(k.refund_amount)}` : ""}` : "—") },
    { key: "opened", header: "Opened", hideBelow: "md", cell: (k) => f.date(k.created_at) },
  ];

  const canManage = can("customers.manage");
  return (
    <AdminPage title={c.full_name || c.email}
      actions={canManage ? <Button variant={c.is_active ? "secondary" : "primary"} className={c.is_active ? "border-bad/40 text-bad hover:bg-bad-soft" : undefined} onClick={() => { toggle.reset(); setConfirming(true); }}>{c.is_active ? "Deactivate account" : "Reactivate account"}</Button> : undefined}>
      <div className="-mt-2">
        <BackLink href="/admin/customers">All customers</BackLink>
        <div className="flex flex-wrap items-center gap-2"><AccountBadge active={c.is_active} /><MarketingBadge optedIn={c.marketing_opt_in} /><span className="text-sm text-ink-2">Customer since {f.date(c.joined_at)}</span></div>
      </div>
      {!c.is_active && <Alert tone="warn" title="This account is deactivated">The customer can&apos;t sign in. Their past orders are unaffected.</Alert>}

      <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="grid min-w-0 items-start gap-6 md:grid-cols-2 xl:grid-cols-1">
          <Card title="Profile">
            <ul className="space-y-1.5 text-sm">
              <li><a className="inline-flex items-center gap-2 text-primary hover:underline" href={`mailto:${c.email}`}><Mail className="size-4 shrink-0" aria-hidden />{c.email}</a></li>
              {c.phone && <li><a className="inline-flex items-center gap-2 text-primary hover:underline" href={`tel:${c.phone}`}><Phone className="size-4 shrink-0" aria-hidden />{c.phone}</a></li>}
            </ul>
            <div className="mt-4"><KeyValue columns={1} items={[
              ["Marketing emails", c.marketing_opt_in ? "Opted in" : "Not opted in"],
              ["Order update emails", c.notify_order_emails ? "On" : "Off"],
            ]} /></div>
          </Card>
          <Card title="Spending">
            <KeyValue columns={1} items={[
              ["Lifetime spend", <span key="s" className="num text-lg font-semibold">{money(c.lifetime_spend)}</span>],
              ["Orders placed", c.orders_count],
              ["Last order", c.last_order_at ? f.dateTime(c.last_order_at) : "Never"],
            ]} />
            <p className="mt-3 text-xs text-ink-3">Lifetime spend adds up completed orders at their final total; cancelled and open orders are not counted.</p>
          </Card>
          <Card title={`Addresses (${c.addresses.length})`}>
            {c.addresses.length === 0 ? <p className="text-sm text-ink-3">No saved addresses.</p> : (
              <ul className="space-y-4 text-sm">
                {c.addresses.map((a) => (
                  <li key={a.id}>
                    <p className="font-semibold">{a.label || a.recipient_name}{a.is_default && <span className="ml-2 rounded-sm bg-paper-2 px-1.5 py-0.5 text-xs font-semibold text-ink-2">Default</span>}</p>
                    <address className="not-italic text-ink-2">{a.recipient_name}{a.phone ? ` · ${a.phone}` : ""}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ""}<br />{[a.area, a.city, a.postal_code].filter(Boolean).join(", ")}{a.instructions && <><br />Instructions: {a.instructions}</>}</address>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <section aria-labelledby="cust-orders">
            <h2 id="cust-orders" className="mb-3 text-xl">Orders ({c.orders.length}{c.orders.length >= DETAIL_LIMIT ? "+" : ""})</h2>
            <DataTable caption={`Orders placed by ${c.full_name || c.email}`} columns={orderColumns} rows={c.orders} rowKey={(o) => o.number} empty={<p className="p-6 text-center text-sm text-ink-3">No orders yet.</p>} />
            {c.orders.length >= DETAIL_LIMIT && <p className="mt-2 text-xs text-ink-3">Showing the {DETAIL_LIMIT} most recent orders.</p>}
          </section>
          <section aria-labelledby="cust-cases">
            <h2 id="cust-cases" className="mb-3 text-xl">Support cases ({c.cases.length}{c.cases.length >= DETAIL_LIMIT ? "+" : ""})</h2>
            <DataTable caption={`Support cases for ${c.full_name || c.email}`} columns={caseColumns} rows={c.cases} empty={<p className="p-6 text-center text-sm text-ink-3">No support cases.</p>} />
          </section>
        </div>
      </div>

      <ConfirmDialog open={confirming} onOpenChange={(o) => { if (!o && !toggle.isPending) setConfirming(false); }} danger={c.is_active} loading={toggle.isPending} confirmLabel={c.is_active ? "Deactivate account" : "Reactivate account"}
        title={c.is_active ? `Deactivate ${c.full_name || c.email}?` : `Reactivate ${c.full_name || c.email}?`}
        description={c.is_active ? "They won't be able to sign in until the account is reactivated. Their orders and history are kept." : "They will be able to sign in again."}
        onConfirm={() => toggle.mutate(!c.is_active)}>
        {toggle.error != null && <ErrorAlert error={toggle.error} />}
      </ConfirmDialog>
    </AdminPage>
  );
}

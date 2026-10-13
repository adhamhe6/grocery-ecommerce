"use client";

import { ClipboardList, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AdminPage } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { useAdmin, useAdminGet } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { ORDER_STATUS_OPTIONS, refundableAmount } from "./actions";
import { DecideDialog } from "./line-dialogs";
import { OrderActions } from "./order-actions";
import { OrderItemsTable } from "./order-items";
import { CasesCard, CustomerCard, FulfilmentCard, PaymentsCard, RefundsCard, SubstitutionsCard, Timeline, TotalsCard } from "./order-panels";
import { ManualRefundDialog, RefundDialog } from "./refund-dialog";
import { BackLink, FulfilmentLabel, OrderStatusBadge, PaymentBadge, SlaBadge, orderPath, useNow, useZoneFormat } from "./shared";
import { slaFor } from "./sla";
import type { OrderDetail, RefundRow, SubstitutionRow } from "./types";

const STATUS_LABELS = Object.fromEntries(ORDER_STATUS_OPTIONS);

export function OrderDetailPage({ number }: { number: string }) {
  return <RequireCapability any={["orders.read"]}><OrderDetailInner number={number} /></RequireCapability>;
}

function OrderDetailInner({ number }: { number: string }) {
  const { can } = useAdmin();
  const router = useRouter();
  const f = useZoneFormat();
  const now = useNow();
  const q = useAdminGet<OrderDetail>(orderPath(number), {}, { refetchInterval: 30_000 });
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [payout, setPayout] = React.useState<RefundRow | null>(null);
  const [deciding, setDeciding] = React.useState<SubstitutionRow | null>(null);
  const order = q.data;

  if (q.error && !order) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <AdminPage title={`Order ${number}`}>
        <BackLink href="/admin/orders">All orders</BackLink>
        <ErrorState error={q.error} onRetry={() => q.refetch()} title={notFound ? "We couldn't find that order" : "We couldn't load this order"} />
      </AdminPage>
    );
  }
  if (!order) {
    return (
      <AdminPage title={`Order ${number}`}>
        <div aria-busy="true" className="space-y-4"><Skeleton className="h-10 w-72" /><div className="grid gap-4 lg:grid-cols-[1fr_22rem]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></div>
      </AdminPage>
    );
  }

  const sla = slaFor(order, now);
  const refundable = refundableAmount(order.payments, order.refunds);
  const closed = ["COMPLETED", "CANCELLED", "PAYMENT_FAILED"].includes(order.status);

  return (
    <AdminPage title={`Order ${order.number}`}
      actions={<><Button variant="secondary" size="sm" onClick={() => q.refetch()} loading={q.isFetching && !q.isLoading} aria-label="Refresh order"><RefreshCw className="size-4" aria-hidden />Refresh</Button></>}>
      <div>
        <BackLink href="/admin/orders">All orders</BackLink>
        <div className="flex flex-wrap items-center gap-2" aria-label="Order status">
          <OrderStatusBadge status={order.status} label={order.status_label} />
          <PaymentBadge status={order.payment_status} />
          {order.payment_method === "COD" && <Badge tone="neutral">Cash on {order.fulfilment_type === "DELIVERY" ? "delivery" : "pickup"}</Badge>}
          {order.awaiting_customer && <Badge tone="warn">Awaiting customer&apos;s answer</Badge>}
          {!closed && <SlaBadge sla={sla} />}
          <span className="text-sm text-ink-2"><FulfilmentLabel type={order.fulfilment_type} /> · {order.branch} · placed {f.dateTime(order.placed_at)}</span>
        </div>
        {q.error && <Alert tone="warn" title="Couldn't refresh" className="mt-3">Showing the last version we loaded. {q.error instanceof ApiError ? q.error.message : ""}</Alert>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <OrderActions order={order} onDone={(a, o) => { if (a.key === "start-picking" && can("orders.fulfil")) router.push(`/admin/picking/${encodeURIComponent(o.number)}`); }} />
          {can("orders.fulfil") && ["PICKING", "PACKING"].includes(order.status) && (
            <ButtonLink href={`/admin/picking/${encodeURIComponent(order.number)}`} variant="secondary"><ClipboardList className="size-4" aria-hidden />Open pick sheet</ButtonLink>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="order-items">
            <h2 id="order-items" className="mb-3 text-xl">Items ({order.items.length})</h2>
            <OrderItemsTable order={order} />
          </section>
          <SubstitutionsCard order={order} onDecide={setDeciding} />
          <Timeline history={order.history} labels={STATUS_LABELS} />
        </div>
        <div className="grid min-w-0 items-start gap-6 md:grid-cols-2 xl:grid-cols-1">
          <TotalsCard order={order} />
          <CustomerCard order={order} />
          <FulfilmentCard order={order} />
          <PaymentsCard order={order} onRefund={() => setRefundOpen(true)} />
          <RefundsCard order={order} onRecordPayout={setPayout} />
          <CasesCard order={order} />
        </div>
      </div>

      <RefundDialog order={order} refundable={refundable} open={refundOpen} onOpenChange={setRefundOpen} />
      <ManualRefundDialog order={order} refund={payout} onClose={() => setPayout(null)} />
      <DecideDialog order={order} substitution={deciding} onClose={() => setDeciding(null)} />
    </AdminPage>
  );
}

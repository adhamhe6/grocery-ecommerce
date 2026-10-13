"use client";

import { RotateCcw } from "lucide-react";
import * as React from "react";
import { KeyValue } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { useAdmin, useAdminGet } from "@/lib/admin";
import { useMoneyIn, useStoreDateTime } from "./format";
import { ManualRefundDialog } from "./manual-refund-dialog";
import { DemoBadge, Mono, OrderLink, OutcomeBadge, PaymentStateBadge, RefundStatusBadge } from "./parts";
import { RefundDialog } from "./refund-dialog";
import { fromCents, REFUNDABLE_STATES, refundableCents } from "./refund-logic";
import { providerLabel, refundMethodLabel, type PaymentDetail } from "./types";

export function PaymentDrawer({ paymentId, onClose }: { paymentId: number | null; onClose: () => void }) {
  return (
    <Sheet open={paymentId !== null} onOpenChange={(o) => !o && onClose()} title="Payment details" widthClass="w-[min(100vw,36rem)]">
      <div className="flex-1 overflow-y-auto p-5">{paymentId !== null && <DrawerBody paymentId={paymentId} />}</div>
    </Sheet>
  );
}

function DrawerBody({ paymentId }: { paymentId: number }) {
  const { can } = useAdmin();
  const money = useMoneyIn();
  const when = useStoreDateTime({ seconds: true });
  const q = useAdminGet<PaymentDetail>(`/payments/${paymentId}/`);
  const [refunding, setRefunding] = React.useState(false);
  const [recording, setRecording] = React.useState<{ id: number; amount: string } | null>(null);
  const p = q.data;

  if (q.isLoading) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-40 w-full" /><Skeleton className="h-32 w-full" /></div>;
  if (q.error || !p) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load this payment" />;

  const refundable = refundableCents(p, p.refunds);
  const canRefund = can("orders.refund") && REFUNDABLE_STATES.includes(p.state) && refundable > 0;
  const m = (v: string) => money(v, p.currency);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <PaymentStateBadge state={p.state} label={p.state_label} />
        <span>{providerLabel(p.provider)}</span>
        {p.is_demo && <DemoBadge />}
      </div>

      {p.is_demo && (
        <Alert tone="info" title="Demo payment">This payment went through the demo sandbox. Nothing was charged and any refund is simulated — no money moves.</Alert>
      )}
      {(p.failure_code || p.failure_message) && (
        <Alert tone="bad" title="This payment didn't go through">{p.failure_message || "No message was given."}{p.failure_code && <span className="block text-xs text-ink-3">Code: {p.failure_code}</span>}</Alert>
      )}

      <KeyValue
        items={[
          ["Order", <OrderLink key="o" number={p.order} />],
          ["Store", p.branch],
          ["Method", p.method],
          ["Attempt", String(p.attempt)],
          ["Authorised / due", <span key="a" className="num">{m(p.amount)}</span>],
          ["Captured", <span key="c" className="num">{m(p.captured)}</span>],
          ["Refunded", <span key="r" className="num">{m(p.refunded)}</span>],
          ["Can still refund", REFUNDABLE_STATES.includes(p.state) ? <span key="rf" className="num font-semibold">{m(fromCents(refundable))}</span> : "—"],
          ["Created", when(p.created_at)],
          ["Captured / collected", when(p.captured_at)],
          ["Provider reference", p.reference ? <Mono key="ref">{p.reference}</Mono> : "None yet"],
        ]}
      />

      {can("orders.refund") && (
        <div>
          <Button onClick={() => setRefunding(true)} disabled={!canRefund}><RotateCcw className="size-4" aria-hidden /> Refund…</Button>
          {!canRefund && <p className="mt-1.5 text-sm text-ink-3">{REFUNDABLE_STATES.includes(p.state) ? "Everything captured has already been refunded or is waiting on a pending refund." : "Only captured or collected payments can be refunded."}</p>}
        </div>
      )}

      <section aria-labelledby="pd-refunds">
        <h3 id="pd-refunds" className="font-sans text-sm font-bold uppercase tracking-wide text-ink-2">Refunds on this payment</h3>
        {p.refunds.length === 0 ? <p className="mt-2 text-sm text-ink-3">No refunds yet.</p> : (
          <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-white text-sm">
            {p.refunds.map((r) => (
              <li key={r.id} className="space-y-1 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="num font-semibold">{m(r.amount)}</span>
                  <span className="flex items-center gap-2"><span className="text-ink-3">{refundMethodLabel(r.method)}</span><RefundStatusBadge status={r.status} /></span>
                </div>
                <p className="text-ink-2">{r.reason}</p>
                <p className="text-xs text-ink-3">{when(r.created_at)}{r.reference && <> · Reference <Mono>{r.reference}</Mono></>}</p>
                {r.status === "PENDING" && r.method === "MANUAL" && can("orders.refund") && (
                  <Button size="sm" variant="secondary" onClick={() => setRecording({ id: r.id, amount: r.amount })}>Record handover</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="pd-events">
        <h3 id="pd-events" className="font-sans text-sm font-bold uppercase tracking-wide text-ink-2">Provider events</h3>
        {p.events.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">{p.provider === "cod" ? "Cash on delivery has no provider notifications." : "No provider notifications have been received for this payment."}</p>
        ) : (
          <ol className="mt-3 space-y-0 border-l-2 border-line pl-4">
            {p.events.map((e) => (
              <li key={`${e.event_id}-${e.at}`} className="relative pb-4 last:pb-0">
                <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full border-2 border-white bg-primary" aria-hidden />
                <div className="flex flex-wrap items-center gap-2 text-sm"><Mono className="text-sm font-semibold">{e.type}</Mono><OutcomeBadge outcome={e.outcome} /></div>
                <p className="mt-0.5 text-xs text-ink-3">{when(e.at)} · event <Mono>{e.event_id}</Mono></p>
                {e.error && <p className="mt-0.5 text-sm text-ink-2">{e.error}</p>}
              </li>
            ))}
          </ol>
        )}
        {p.events.length >= 100 && <p className="mt-2 text-xs text-ink-3">Showing the most recent 100 events.</p>}
      </section>

      {refunding && <RefundDialog paymentId={p.id} onClose={() => setRefunding(false)} />}
      {recording && <ManualRefundDialog order={p.order} refundId={recording.id} amount={recording.amount} currency={p.currency} onClose={() => setRecording(null)} />}
    </div>
  );
}

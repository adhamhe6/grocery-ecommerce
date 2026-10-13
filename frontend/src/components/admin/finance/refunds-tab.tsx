"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Alert, EmptyState, Skeleton } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { useMoneyIn, useStoreDateTime } from "./format";
import { ManualRefundDialog } from "./manual-refund-dialog";
import { DemoBadge, Mono, OrderLink, ProviderCell, RefundStatusBadge } from "./parts";
import { RefundDialog } from "./refund-dialog";
import { REFUND_STATUSES, refundMethodLabel, type FinanceUrl, type PaymentRow, type RefundRow } from "./types";

export function RefundsTab({ s, set }: { s: FinanceUrl; set: (patch: Partial<FinanceUrl>) => void }) {
  const { can } = useAdmin();
  const money = useMoneyIn();
  const when = useStoreDateTime({ compact: true });
  const page = Math.max(1, Number(s.rpage) || 1);
  const list = useAdminList<RefundRow>("/payments/refunds/", { status: s.rstatus, page });
  const [picking, setPicking] = React.useState(false);
  const [refundFor, setRefundFor] = React.useState<number | null>(null);
  const [recording, setRecording] = React.useState<RefundRow | null>(null);
  const canRefund = can("orders.refund");

  const columns: Column<RefundRow>[] = [
    { key: "created", header: "Requested", cell: (r) => <span className="whitespace-nowrap">{when(r.created_at)}</span> },
    { key: "order", header: "Order", cell: (r) => <OrderLink number={r.order} /> },
    { key: "amount", header: "Amount", align: "right", cell: (r) => money(r.amount) },
    { key: "method", header: "Method", hideBelow: "md", cell: (r) => refundMethodLabel(r.method) },
    {
      key: "status", header: "Status",
      cell: (r) => (
        <div className="space-y-1">
          <RefundStatusBadge status={r.status} />
          {r.status === "FAILED" && r.failure && <p className="max-w-56 text-xs text-ink-2">{r.failure}</p>}
          {r.status === "PENDING" && r.method === "MANUAL" && <p className="max-w-56 text-xs text-ink-3">Waiting for the handover to be recorded.</p>}
          {r.status === "PENDING" && r.method === "PROVIDER" && <p className="max-w-56 text-xs text-ink-3">{r.failure || "Waiting for the provider to confirm."}</p>}
        </div>
      ),
    },
    { key: "reason", header: "Reason", hideBelow: "lg", cell: (r) => <span className="line-clamp-2 max-w-64">{r.reason}</span> },
    { key: "ref", header: "Reference", hideBelow: "lg", cell: (r) => (r.reference ? <Mono>{r.reference}</Mono> : <span className="text-ink-3">—</span>) },
    { key: "by", header: "Requested by", hideBelow: "md", cell: (r) => <span className="break-all">{r.requested_by}</span> },
    { key: "done", header: "Completed", hideBelow: "lg", cell: (r) => (r.completed_at ? when(r.completed_at) : <span className="text-ink-3">—</span>) },
    ...(canRefund
      ? [{
          key: "actions", header: "Action",
          cell: (r: RefundRow) => (r.status === "PENDING" && r.method === "MANUAL"
            ? <Button size="sm" variant="secondary" onClick={() => setRecording(r)}>Record handover</Button>
            : null),
        }]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Demo refunds are simulated">
        A refund on a demo payment completes instantly and no money moves. Cash-on-delivery refunds and manual refunds stay pending until someone records the receipt for the money handed back.
      </Alert>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar>
          <FilterSelect label="Status" value={s.rstatus} onChange={(v) => set({ rstatus: v, rpage: "1" })} options={REFUND_STATUSES} allLabel="All statuses" />
        </FilterBar>
        {canRefund && <Button onClick={() => setPicking(true)}><Plus className="size-4" aria-hidden /> New refund</Button>}
      </div>

      <DataTable
        caption="Refunds, newest first"
        columns={columns}
        rows={list.rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={s.rstatus
          ? <EmptyState title="No refunds with this status">Try another status.</EmptyState>
          : <EmptyState title="No refunds yet">Refunds made from this page or from an order appear here.</EmptyState>}
      />
      {!list.error && !list.isLoading && <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={(p) => set({ rpage: String(p) })} label="refunds" />}

      {picking && <PaymentPicker onClose={() => setPicking(false)} onPick={(id) => { setPicking(false); setRefundFor(id); }} />}
      {refundFor !== null && <RefundDialog paymentId={refundFor} onClose={() => setRefundFor(null)} />}
      {recording && <ManualRefundDialog order={recording.order} refundId={recording.id} amount={recording.amount} onClose={() => setRecording(null)} />}
    </div>
  );
}

/** Step 1 of "New refund": find the captured payment by order number, provider reference or email. */
function PaymentPicker({ onClose, onPick }: { onClose: () => void; onPick: (paymentId: number) => void }) {
  const money = useMoneyIn();
  const [text, setText] = React.useState("");
  const term = useDebouncedValue(text.trim());
  const ready = term.length >= 2;
  const list = useAdminList<PaymentRow>("/payments/", { state: "CAPTURED,PARTIALLY_REFUNDED", search: term, page_size: 8 }, { enabled: ready });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New refund" description="Find the captured payment you want to refund. Only captured or collected payments can be refunded.">
        <SearchField value={text} onChange={setText} label="Find a payment" placeholder="Order number, provider reference or email" />
        <div className="mt-4 min-h-24" aria-live="polite">
          {!ready ? <p className="text-sm text-ink-3">Type at least 2 characters.</p>
            : list.isLoading ? <div className="space-y-2" aria-busy="true"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
            : list.error ? <Alert tone="bad">We couldn&apos;t search payments. Try again in a moment.</Alert>
            : list.rows.length === 0 ? <p className="text-sm text-ink-2">No captured payments match “{term}”.</p>
            : (
              <ul className="divide-y divide-line rounded-md border border-line bg-white">
                {list.rows.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => onPick(p.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-paper-2">
                      <span className="flex flex-col gap-0.5"><span className="num font-semibold">{p.order}</span><ProviderCell p={p} /></span>
                      <span className="num text-right">{money(p.captured, p.currency)} captured<span className="block text-xs text-ink-3">{Number(p.refunded) > 0 ? `${money(p.refunded, p.currency)} already refunded` : "nothing refunded yet"}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-3"><DemoBadge /> payments are simulated: refunding them moves no money.</p>
      </DialogContent>
    </Dialog>
  );
}

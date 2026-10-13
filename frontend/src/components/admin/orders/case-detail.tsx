"use client";

import Link from "next/link";
import * as React from "react";
import { AdminPage, Card, ConfirmDialog, KeyValue, StatusBadge } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { ChoiceGroup, Field, Input, Textarea, describedBy } from "@/components/ui/field";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { adminRequest, fieldErrorsOf, useAdmin, useAdminAction, useAdminGet } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { useMoney } from "@/lib/hooks";
import { validateRefundAmount } from "./actions";
import { CASE_STATUS_LABELS, RESOLUTION_LABELS } from "./cases-list";
import { decimalInput, fmtMoney, parseMoney } from "./decimal";
import { BackLink, ErrorAlert, OrderStatusBadge, useZoneFormat } from "./shared";
import type { CaseRefund, CaseResolutionValue, SupportCase } from "./types";

type ResolveResponse = SupportCase & { refund: CaseRefund | null };
const NOTES_MAX = 2000;

export function CaseDetailPage({ id }: { id: string }) {
  return <RequireCapability any={["support.manage"]}><CaseDetailInner id={id} /></RequireCapability>;
}

function CaseDetailInner({ id }: { id: string }) {
  const { can } = useAdmin();
  const money = useMoney();
  const f = useZoneFormat();
  const q = useAdminGet<SupportCase>(`/cases/${encodeURIComponent(id)}/`);
  const [outcome, setOutcome] = React.useState<CaseRefund | null>(null);
  const c = q.data;

  if (q.error && !c) return <AdminPage title={`Case #${id}`}><BackLink href="/admin/cases">All cases</BackLink><ErrorState error={q.error} onRetry={() => q.refetch()} title={q.error instanceof ApiError && q.error.status === 404 ? "We couldn't find that case" : "We couldn't load this case"} /></AdminPage>;
  if (!c) return <AdminPage title={`Case #${id}`}><div aria-busy="true" className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div></AdminPage>;

  const active = c.status === "OPEN" || c.status === "IN_REVIEW";
  return (
    <AdminPage title={`Case #${c.id}`}>
      <div className="-mt-2">
        <BackLink href="/admin/cases">All cases</BackLink>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={c.status} label={CASE_STATUS_LABELS[c.status]} />
          <span className="font-semibold text-ink">{c.kind_label}</span>
          <span className="text-sm text-ink-2">opened {f.dateTime(c.created_at)} · {c.branch.name}</span>
        </div>
      </div>

      {outcome && <Alert tone={outcome.completed ? "ok" : "warn"} title={outcome.completed ? `Refund of ${money(outcome.amount)} issued` : `Refund of ${money(outcome.amount)} is ${outcome.status.toLowerCase()}, not paid out`}>{outcome.message}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-6">
          <Card title="What the customer reported">
            <p className="whitespace-pre-wrap text-ink">{c.description}</p>
            {c.order_item && <p className="mt-3 text-sm text-ink-2">About: <strong>{c.order_item.name}</strong></p>}
          </Card>
          <Card title="Order and customer">
            <KeyValue columns={2} items={[
              ["Order", <span key="o" className="flex flex-wrap items-center gap-2"><Link className="font-semibold text-primary hover:underline" href={`/admin/orders/${encodeURIComponent(c.order_number)}`}>{c.order_number}</Link><OrderStatusBadge status={c.order_status} /></span>],
              ["Customer", c.customer.id && can("customers.read") ? <Link key="c" className="font-semibold text-primary hover:underline" href={`/admin/customers/${c.customer.id}`}>{c.customer.name}</Link> : c.customer.name],
              ["Paid by", c.payment_method === "COD" ? "Cash on delivery/pickup" : "Card"],
              ["Still refundable", c.refundable === null ? "Nothing collected yet" : money(c.refundable)],
            ]} />
          </Card>
          {c.refunds.length > 0 && (
            <Card title="Refunds from this case">
              <ul className="divide-y divide-line text-sm">
                {c.refunds.map((r) => (
                  <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="num font-semibold">{money(r.amount)}</span><StatusBadge status={r.status} /><span className="text-xs text-ink-3">{f.dateTime(r.created_at)}</span></div>
                    <p className="mt-1 text-ink-2">{r.message}</p>
                    {r.status === "PENDING" && r.method === "MANUAL" && can("orders.refund") && <p className="mt-1 text-xs text-ink-3"><Link className="font-semibold text-primary underline" href={`/admin/orders/${encodeURIComponent(c.order_number)}`}>Open the order</Link> to record the receipt once the money has been handed over.</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="min-w-0">
          {active ? <HandleCard c={c} onResolved={setOutcome} /> : (
            <Card title="Outcome">
              <KeyValue columns={1} items={[
                ["Decision", c.status === "REJECTED" ? "Rejected" : RESOLUTION_LABELS[c.resolution]],
                ["Refund", (parseMoney(c.refund_amount) ?? 0n) > 0n ? `${money(c.refund_amount)} (${c.refund_status === "SUCCEEDED" ? "paid" : "not paid out yet"})` : "None"],
                ["Handled by", c.handled_by ?? "—"],
                ["Closed", f.dateTime(c.resolved_at)],
                [c.status === "REJECTED" ? "Reason given to the customer" : "Notes", c.staff_notes ? <span key="n" className="whitespace-pre-wrap">{c.staff_notes}</span> : "—"],
              ]} />
            </Card>
          )}
        </div>
      </div>
    </AdminPage>
  );
}

// ------------------------------------------------------------------------------------------------ resolve / reject
function HandleCard({ c, onResolved }: { c: SupportCase; onResolved: (r: CaseRefund | null) => void }) {
  const money = useMoney();
  const base = `/cases/${c.id}/`;
  const [resolution, setResolution] = React.useState<CaseResolutionValue | "">("");
  const [amount, setAmount] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [errors, setErrors] = React.useState<{ resolution?: string; amount?: string; notes?: string }>({});
  const [confirm, setConfirm] = React.useState<"resolve" | "reject" | null>(null);

  const review = useAdminAction(() => adminRequest("POST", `${base}review/`), { invalidate: ["/cases"], success: "You're now reviewing this case" });
  const resolve = useAdminAction((body: Record<string, unknown>) => adminRequest<ResolveResponse>("POST", `${base}resolve/`, body), {
    invalidate: ["/cases", "/orders"], onSuccess: (d) => { setConfirm(null); onResolved(d.refund); },
  });
  const reject = useAdminAction((body: Record<string, unknown>) => adminRequest<SupportCase>("POST", `${base}reject/`, body), { invalidate: ["/cases"], success: "Case rejected", onSuccess: () => setConfirm(null) });

  const money_ = resolution === "REFUND" || resolution === "GOODWILL";
  const refundable = c.refundable;
  const noMoneyToReturn = refundable === null || (parseMoney(refundable) ?? 0n) <= 0n;
  const cod = c.payment_method === "COD";
  const fe = { ...fieldErrorsOf(resolve.error), ...fieldErrorsOf(reject.error) };
  const err = { resolution: errors.resolution ?? fe.resolution, amount: errors.amount ?? fe.refund_amount, notes: errors.notes ?? fe.staff_notes };

  const body = () => ({ resolution, refund_amount: money_ ? fmtMoney(parseMoney(amount.trim()) ?? 0n) : undefined, staff_notes: notes.trim() });

  const askResolve = () => {
    const next: typeof errors = {};
    if (!resolution) next.resolution = "Choose how this case is resolved.";
    if (money_) { const m = validateRefundAmount(amount, refundable, money); if (m) next.amount = m; }
    setErrors(next);
    if (Object.keys(next).length) return;
    resolve.reset();
    setConfirm("resolve");
  };
  const askReject = () => {
    if (!notes.trim()) { setErrors({ notes: "Explain why the case is rejected: the customer is told this reason." }); return; }
    setErrors({});
    reject.reset();
    setConfirm("reject");
  };

  return (
    <Card title="Handle this case">
      <div className="space-y-5">
        {c.status === "OPEN" ? (
          <div>
            <Button variant="secondary" loading={review.isPending} onClick={() => review.mutate(undefined)}>Start review</Button>
            <p className="mt-1.5 text-xs text-ink-3">Tells colleagues you are looking at it. Optional.</p>
          </div>
        ) : <p className="text-sm text-ink-2">In review{c.handled_by ? ` by ${c.handled_by}` : ""}.</p>}

        <ChoiceGroup name="resolution" legend="Resolution" value={resolution} onChange={(v) => { setResolution(v); setErrors((e) => ({ ...e, resolution: undefined, amount: undefined })); }}
          options={[
            { value: "NONE", title: "No action", description: "Close the case without compensation." },
            { value: "REFUND", title: "Refund", description: "Return money for the affected items.", disabled: noMoneyToReturn },
            { value: "GOODWILL", title: "Goodwill refund", description: "A gesture of goodwill, paid as a refund.", disabled: noMoneyToReturn },
            { value: "REPLACEMENT", title: "Replacement", description: "Records that a replacement is being arranged. No new order is created here." },
          ]} />
        {err.resolution && <p role="alert" className="text-sm font-medium text-bad">{err.resolution}</p>}
        {noMoneyToReturn && <Alert tone="info" title="No money to return">{refundable === null ? "Nothing has been collected on this order yet" : "The whole collected amount has already been refunded or is pending refund"}, so a refund can&apos;t be issued.</Alert>}

        {money_ && (
          <Field label="Refund amount" htmlFor="case-amount" required error={err.amount} hint={refundable ? `Up to ${money(refundable)} can still be refunded.` : undefined}>
            <div className="flex gap-2">
              <Input id="case-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} aria-invalid={!!err.amount} aria-describedby={describedBy("case-amount", !!refundable, !!err.amount)} onChange={(e) => { setAmount(decimalInput(e.target.value)); setErrors((x) => ({ ...x, amount: undefined })); }} />
              {refundable && <Button variant="secondary" className="shrink-0" onClick={() => setAmount(refundable)}>Full amount</Button>}
            </div>
          </Field>
        )}
        {money_ && cod && <Alert tone="info" title="Paid out by hand">This is a cash-on-delivery order, so the refund is recorded as pending until the money is handed over and the receipt is entered on the order.</Alert>}

        <Field label="Notes" htmlFor="case-notes" error={err.notes} hint="Kept on the case for colleagues. If you reject the case, the customer is told this reason.">
          <Textarea id="case-notes" value={notes} maxLength={NOTES_MAX} aria-invalid={!!err.notes} aria-describedby={describedBy("case-notes", true, !!err.notes)} onChange={(e) => { setNotes(e.target.value); setErrors((x) => ({ ...x, notes: undefined })); }} />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button onClick={askResolve} disabled={resolve.isPending || reject.isPending}>Resolve case</Button>
          <Button variant="secondary" className="border-bad/40 text-bad hover:bg-bad-soft" onClick={askReject} disabled={resolve.isPending || reject.isPending}>Reject case</Button>
        </div>
      </div>

      <ConfirmDialog open={confirm === "resolve"} onOpenChange={(o) => { if (!o && !resolve.isPending) setConfirm(null); }} danger={money_} loading={resolve.isPending} confirmLabel={money_ ? "Resolve and refund" : "Resolve case"}
        title={money_ ? `Resolve and refund ${money(fmtMoney(parseMoney(amount.trim()) ?? 0n))}?` : "Resolve this case?"}
        description={money_ ? (cod ? "The refund is recorded as pending until the cash is handed over and the receipt is entered on the order." : "The money is returned to the customer's original payment. This can't be undone.") : "The case is closed and can't be changed afterwards."}
        onConfirm={() => resolve.mutate(body())}>
        <p className="text-sm text-ink-2">Outcome: <strong className="text-ink">{resolution ? RESOLUTION_LABELS[resolution] : ""}</strong>.</p>
        {resolve.error != null && <ErrorAlert error={resolve.error} />}
      </ConfirmDialog>
      <ConfirmDialog open={confirm === "reject"} onOpenChange={(o) => { if (!o && !reject.isPending) setConfirm(null); }} danger loading={reject.isPending} confirmLabel="Reject case" title="Reject this case?"
        description="The case is closed with no compensation and the customer is told your reason." onConfirm={() => reject.mutate({ staff_notes: notes.trim() })}>
        <p className="whitespace-pre-wrap rounded-md bg-paper-2 p-3 text-sm text-ink-2">{notes.trim()}</p>
        {reject.error != null && <ErrorAlert error={reject.error} />}
      </ConfirmDialog>
    </Card>
  );
}

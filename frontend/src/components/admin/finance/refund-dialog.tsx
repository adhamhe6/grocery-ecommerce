"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea, describedBy } from "@/components/ui/field";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { newIdempotencyKey } from "@/lib/api";
import { adminRequest, useAdminAction, useAdminGet } from "@/lib/admin";
import { useMoneyIn } from "./format";
import { FINANCE_INVALIDATE, ManualRefundDialog } from "./manual-refund-dialog";
import { DemoBadge } from "./parts";
import { draftSignature, fromCents, isManualRefund, REFUNDABLE_STATES, refundableCents, refundPayload, toCents, validateRefundAmount, validateRefundReason } from "./refund-logic";
import { serverFormErrors } from "./server-errors";
import { providerLabel, type PaymentDetail, type RefundResponse } from "./types";

/** Create a refund against one captured payment: form → review → result. Mount it only while it is open. */
export function RefundDialog({ paymentId, onClose }: { paymentId: number; onClose: () => void }) {
  const detail = useAdminGet<PaymentDetail>(`/payments/${paymentId}/`);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Refund a payment" description="Refunds are recorded on the order and in the audit log." className="w-[min(94vw,36rem)]">
        {detail.isLoading ? (
          <div className="space-y-3" aria-busy="true"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : detail.error || !detail.data ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} title="We couldn't load this payment" />
        ) : (
          <RefundFlow payment={detail.data} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Step = "form" | "confirm" | "done";

function RefundFlow({ payment, onClose }: { payment: PaymentDetail; onClose: () => void }) {
  const money = useMoneyIn();
  const fmt = React.useCallback((s: string) => money(s, payment.currency), [money, payment.currency]);
  const isCod = payment.provider === "cod";
  const pendingCents = payment.refunds.filter((r) => r.status === "PENDING").reduce((n, r) => n + (toCents(r.amount) ?? 0), 0);
  const refundable = fromCents(refundableCents(payment, payment.refunds));
  const eligible = REFUNDABLE_STATES.includes(payment.state);

  const [step, setStep] = React.useState<Step>("form");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [manual, setManual] = React.useState(isCod);
  const [touched, setTouched] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const [outcome, setOutcome] = React.useState<RefundResponse["refund_result"] | null>(null);
  const keyRef = React.useRef<{ sig: string; key: string } | null>(null);

  const amountCheck = validateRefundAmount(amount, refundable, fmt);
  const reasonError = validateRefundReason(reason);
  const draft = { amount: amountCheck.ok ? amountCheck.amount : amount, reason, manual };
  const effectiveManual = isManualRefund(payment.provider, manual);

  const run = useAdminAction(
    (body: ReturnType<typeof refundPayload>) => adminRequest<RefundResponse>("POST", `/orders/${encodeURIComponent(payment.order)}/refund/`, body),
    { invalidate: FINANCE_INVALIDATE, onSuccess: (data) => { setOutcome(data.refund_result); setStep("done"); } },
  );
  const errors = serverFormErrors(run.error, ["amount", "reason", "manual", "idempotency_key"]);

  // The same draft always reuses the same key (a retry or double click returns the existing refund); editing it mints a new one.
  const keyFor = (sig: string) => {
    if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };
    return keyRef.current.key;
  };
  const submit = () => {
    if (!amountCheck.ok || run.isPending) return;
    run.mutate(refundPayload(draft, keyFor(draftSignature(draft))));
  };

  if (step === "done" && outcome) {
    return (
      <div className="space-y-4">
        <ResultNotice status={outcome.status} message={outcome.message} manual={effectiveManual} demo={payment.is_demo} amount={fmt(draft.amount)} />
        <div className="flex flex-wrap justify-end gap-2">
          {outcome.status === "PENDING" && effectiveManual && <Button onClick={() => setRecording(true)}>Record handover now</Button>}
          <Button variant="secondary" onClick={onClose}>Done</Button>
        </div>
        {recording && <ManualRefundDialog order={payment.order} refundId={outcome.id} amount={draft.amount} currency={payment.currency} onClose={() => { setRecording(false); onClose(); }} />}
      </div>
    );
  }

  if (!eligible) {
    return (
      <div className="space-y-4">
        <Alert tone="warn" title="This payment can't be refunded">Only captured or collected payments can be refunded. This one is “{payment.state_label}”.</Alert>
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    );
  }

  const amountError = (touched && !amountCheck.ok ? amountCheck.message : undefined) ?? errors.fields.amount;
  const reasonMessage = (touched ? reasonError ?? undefined : undefined) ?? errors.fields.reason;

  if (step === "confirm" && amountCheck.ok) {
    return (
      <div className="space-y-4">
        <dl className="grid gap-3 rounded-md border border-line bg-white p-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Order</dt><dd className="num mt-0.5 font-semibold">{payment.order}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Refund amount</dt><dd className="num mt-0.5 text-lg font-semibold">{fmt(amountCheck.amount)}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">How it is paid back</dt>
            <dd className="mt-0.5">{howText(payment.provider, payment.is_demo, effectiveManual)}</dd>
          </div>
          <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Reason</dt><dd className="mt-0.5 whitespace-pre-wrap break-words">{reason.trim()}</dd></div>
        </dl>
        {payment.is_demo && !effectiveManual && <Alert tone="info" title="Demo payment">The refund is simulated by the demo sandbox. It completes instantly and no money moves.</Alert>}
        {!payment.is_demo && !effectiveManual && <Alert tone="warn" title="This sends a real refund request">It goes to {providerLabel(payment.provider)} straight away and can&apos;t be undone from here.</Alert>}
        {errors.form && <Alert tone="bad" title="The refund wasn't made">{errors.form}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setStep("form")} disabled={run.isPending}>Back</Button>
          <Button variant="danger" loading={run.isPending} onClick={submit}>Confirm refund of {fmt(amountCheck.amount)}</Button>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (amountCheck.ok && !reasonError) setStep("confirm");
      }}
    >
      <dl className="grid grid-cols-2 gap-3 rounded-md border border-line bg-white p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Order</dt><dd className="num mt-0.5 font-semibold">{payment.order}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Captured</dt><dd className="num mt-0.5">{fmt(payment.captured)}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Refunded</dt><dd className="num mt-0.5">{fmt(payment.refunded)}{pendingCents > 0 && <span className="block text-xs text-ink-3">+ {fmt(fromCents(pendingCents))} pending</span>}</dd></div>
        <div><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">Can still refund</dt><dd className="num mt-0.5 font-semibold">{fmt(refundable)}</dd></div>
        <div className="col-span-full flex flex-wrap items-center gap-2"><dt className="sr-only">Provider</dt><dd className="flex items-center gap-2">{providerLabel(payment.provider)}{payment.is_demo && <DemoBadge />}</dd></div>
      </dl>

      {payment.is_demo && !effectiveManual && (
        <Alert tone="info" title="Demo payment — refunds are simulated">The demo sandbox completes the refund instantly and no money moves.</Alert>
      )}
      {isCod && (
        <Alert tone="info" title="Cash on delivery is refunded manually">Hand the money back to the customer, then record the receipt number. The refund stays pending until you do.</Alert>
      )}

      <Field label="Refund amount" htmlFor="refund-amount" required error={amountError} hint={`Up to ${fmt(refundable)}.`}>
        <div className="flex gap-2">
          <Input id="refund-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => { setAmount(e.target.value); run.reset(); }} aria-invalid={!!amountError} aria-describedby={describedBy("refund-amount", true, !!amountError)} placeholder="0.00" autoFocus />
          <Button variant="secondary" onClick={() => { setAmount(refundable); run.reset(); }}>Full amount</Button>
        </div>
      </Field>

      <Field label="Reason" htmlFor="refund-reason" required error={reasonMessage} hint="Shown on the order and in the audit log (max 300 characters).">
        <Textarea id="refund-reason" rows={2} maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); run.reset(); }} aria-invalid={!!reasonMessage} aria-describedby={describedBy("refund-reason", true, !!reasonMessage)} className="min-h-16" />
      </Field>

      {!isCod && (
        <Checkbox
          checked={manual}
          onChange={(e) => { setManual(e.target.checked); run.reset(); }}
          label={<><span className="font-semibold">Refund manually</span><span className="block text-sm text-ink-3">Nothing is sent to {providerLabel(payment.provider)}. Use this when you have already handed back cash or store credit; you will record the receipt afterwards.</span></>}
        />
      )}

      {errors.form && <Alert tone="bad">{errors.form}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit">Review refund</Button>
      </div>
    </form>
  );
}

function howText(provider: string, demo: boolean, manual: boolean): string {
  if (manual) return "Recorded manually — you hand the money back yourself and enter the receipt reference afterwards. It stays pending until then.";
  if (demo) return "Simulated by the demo sandbox — no money moves.";
  return `Sent to ${providerLabel(provider)} to return the money to the customer's card.`;
}

function ResultNotice({ status, message, manual, demo, amount }: { status: string; message: string; manual: boolean; demo: boolean; amount: string }) {
  if (status === "SUCCEEDED") {
    return <Alert tone="ok" title={`Refund of ${amount} completed`}>{demo ? "This was a demo payment: the refund is simulated and no money moved." : "The provider confirmed the refund. The payment and the order now show the new refunded amount."}</Alert>;
  }
  if (status === "FAILED") {
    return <Alert tone="bad" title="The refund failed">{message || "The provider didn't accept the refund."} Nothing was refunded.</Alert>;
  }
  if (manual) {
    return <Alert tone="info" title={`Refund of ${amount} recorded — pending`}>Nothing counts as refunded until you record the receipt reference for the money you hand back. You can do that now, or later from the Refunds tab.</Alert>;
  }
  return <Alert tone="warn" title={`Refund of ${amount} submitted — waiting for the provider`}>{message ? `${message} ` : ""}The refund stays pending until the provider confirms it. It will show as completed here once it does.</Alert>;
}

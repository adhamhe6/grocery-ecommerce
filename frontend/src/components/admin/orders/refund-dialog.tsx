"use client";

import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { fieldErrorsOf } from "@/lib/admin";
import { newIdempotencyKey } from "@/lib/api";
import { useMoney } from "@/lib/hooks";
import { describeRefund, validateRefundAmount } from "./actions";
import { decimalInput, fmtMoney, parseMoney } from "./decimal";
import { ErrorAlert, useAsyncTask, useOrderApi } from "./shared";
import type { OrderDetail, RefundRow } from "./types";

const MAX_REASON = 300;

/**
 * Refund request. One idempotency key is minted per distinct request (amount + reason + payout method): pressing the
 * button twice, or retrying after a dropped connection, re-sends the SAME key so the server can never create two
 * refunds; changing anything mints a new key, because the server returns the earlier refund for a repeated key.
 */
export function RefundDialog({ order, refundable, open, onOpenChange }: { order: OrderDetail; refundable: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const money = useMoney();
  const call = useOrderApi(order.number);
  const task = useAsyncTask();
  const cod = order.payment_method === "COD";
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [manual, setManual] = React.useState(cod);
  const [errors, setErrors] = React.useState<{ amount?: string; reason?: string }>({});
  const [result, setResult] = React.useState<OrderDetail | null>(null);
  const keyRef = React.useRef<{ sig: string; key: string } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAmount(""); setReason(""); setManual(cod); setErrors({}); setResult(null); keyRef.current = null; task.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const fe = fieldErrorsOf(task.error);
  const amountError = errors.amount ?? fe.amount;
  const reasonError = errors.reason ?? fe.reason;

  const submit = async () => {
    const next: typeof errors = {};
    const amountMsg = validateRefundAmount(amount, refundable, money);
    if (amountMsg) next.amount = amountMsg;
    if (!reason.trim()) next.reason = "Say why this refund is being made.";
    setErrors(next);
    if (next.amount || next.reason) return;
    const cents = parseMoney(amount.trim())!;
    const body = { amount: fmtMoney(cents), reason: reason.trim(), manual };
    const sig = JSON.stringify(body);
    if (keyRef.current?.sig !== sig) keyRef.current = { sig, key: `refund-${order.number}-${newIdempotencyKey()}` };
    const data = await task.run(() => call("refund/", { ...body, idempotency_key: keyRef.current!.key }));
    if (data) setResult(data);
  };

  if (result) {
    const r = result.refund_result;
    const row = result.refunds.find((x) => x.id === r?.id);
    const outcome = describeRefund({ status: r?.status ?? row?.status ?? "PENDING", method: row?.method, failure: r?.message || row?.failure }, money(row?.amount ?? amount));
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title="Refund requested">
          <Alert tone={outcome.tone} title={outcome.title}>{outcome.body}</Alert>
          <div className="mt-5 flex justify-end"><Button onClick={() => onOpenChange(false)}>Done</Button></div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <ConfirmDialog open={open} onOpenChange={(o) => { if (!task.busy) onOpenChange(o); }} danger loading={task.busy} confirmLabel="Refund" title={`Refund order ${order.number}`}
      description="Refunds can't be undone. Each refund is recorded once even if you press the button twice." onConfirm={submit}>
      <div className="space-y-4">
        <Field label="Amount to refund" htmlFor="refund-amount" required error={amountError} hint={refundable !== null ? `Up to ${money(refundable)} can still be refunded.` : undefined}>
          <div className="flex gap-2">
            <Input id="refund-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} aria-invalid={!!amountError} aria-describedby={describedBy("refund-amount", refundable !== null, !!amountError)}
              onChange={(e) => { setAmount(decimalInput(e.target.value)); setErrors((x) => ({ ...x, amount: undefined })); }} />
            {refundable !== null && <Button variant="secondary" className="shrink-0" onClick={() => { setAmount(refundable); setErrors((x) => ({ ...x, amount: undefined })); }}>Full amount</Button>}
          </div>
        </Field>
        <Field label="Reason" htmlFor="refund-reason" required error={reasonError} hint="Recorded on the refund and in the audit log.">
          <Textarea id="refund-reason" value={reason} maxLength={MAX_REASON} aria-invalid={!!reasonError} aria-describedby={describedBy("refund-reason", true, !!reasonError)}
            onChange={(e) => { setReason(e.target.value); setErrors((x) => ({ ...x, reason: undefined })); }} />
        </Field>
        {cod ? (
          <Alert tone="info" title="Paid out by hand">Cash-on-delivery refunds are handed over in cash or store credit. The refund stays pending until you record the receipt reference.</Alert>
        ) : (
          <div>
            <Checkbox label="Pay out by hand (cash or store credit) instead of back to the original payment" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            {manual && <p className="mt-1.5 pl-8 text-sm text-warn">The card will not be credited. The refund stays pending until you record the receipt reference.</p>}
          </div>
        )}
        {task.error != null && !fe.amount && !fe.reason && <ErrorAlert error={task.error} />}
      </div>
    </ConfirmDialog>
  );
}

/** Confirm that a manual (cash / store-credit) refund has really been handed over. */
export function ManualRefundDialog({ order, refund, onClose }: { order: OrderDetail; refund: RefundRow | null; onClose: () => void }) {
  const money = useMoney();
  const call = useOrderApi(order.number);
  const task = useAsyncTask();
  const [reference, setReference] = React.useState("");
  const [clientError, setClientError] = React.useState("");
  React.useEffect(() => {
    setReference(""); setClientError(""); task.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when a different refund is opened
  }, [refund?.id]);
  const fe = fieldErrorsOf(task.error);
  const error = clientError || fe.reference;

  const submit = async () => {
    if (!refund) return;
    if (!reference.trim()) { setClientError("Enter the receipt number or reference for the money you handed over."); return; }
    const data = await task.run(() => call(`refunds/${refund.id}/complete/`, { reference: reference.trim() }));
    if (data) onClose();
  };

  return (
    <ConfirmDialog open={!!refund} onOpenChange={(o) => { if (!o && !task.busy) onClose(); }} loading={task.busy} confirmLabel="Record payout" title="Record manual payout"
      description={refund ? `Confirm that ${money(refund.amount)} has been handed back to the customer. The refund is only marked as paid once you do.` : undefined} onConfirm={submit}>
      <Field label="Receipt or reference" htmlFor="payout-ref" required error={error}>
        <Input id="payout-ref" value={reference} maxLength={120} aria-invalid={!!error} aria-describedby={describedBy("payout-ref", false, !!error)} onChange={(e) => { setReference(e.target.value); setClientError(""); }} />
      </Field>
      {task.error != null && !fe.reference && <ErrorAlert error={task.error} />}
    </ConfirmDialog>
  );
}

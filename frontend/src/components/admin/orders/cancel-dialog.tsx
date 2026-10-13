"use client";

import * as React from "react";
import { ConfirmDialog } from "@/components/admin/kit";
import { Field, Textarea, describedBy } from "@/components/ui/field";
import { fieldErrorsOf } from "@/lib/admin";
import { useMoney } from "@/lib/hooks";
import { sumCaptured } from "./actions";
import { parseMoney } from "./decimal";
import { ErrorAlert, useAsyncTask, useOrderApi } from "./shared";
import type { OrderDetail } from "./types";

const MAX_REASON = 300;

/** What cancelling will do to the money, stated from the payments the API reports. */
export function cancelConsequences(order: Pick<OrderDetail, "status" | "payments" | "payment_method">, money: (v: string) => string): string[] {
  const lines = ["Reserved stock is released, and anything already picked goes back into stock.", "The delivery or pickup slot is freed up for other customers.", "Any coupon used on the order is released.", "The customer is emailed that the order was cancelled."];
  const captured = sumCaptured(order.payments);
  if ((parseMoney(captured) ?? 0n) > 0n) lines.splice(2, 0, `The ${money(captured)} already collected is refunded in full to the original payment. Check the refunds list afterwards: a cash or provider-outage refund can stay pending until it is paid out.`);
  else if (order.payments.some((p) => p.state === "AUTHORIZED")) lines.splice(2, 0, "The card authorisation hold is released, so the customer is not charged.");
  else lines.splice(2, 0, "No money has been collected, so there is nothing to refund.");
  return lines;
}

export function CancelDialog({ order, open, onOpenChange, onDone }: { order: OrderDetail; open: boolean; onOpenChange: (o: boolean) => void; onDone?: (o: OrderDetail) => void }) {
  const money = useMoney();
  const call = useOrderApi(order.number);
  const task = useAsyncTask();
  const [reason, setReason] = React.useState("");
  const [clientError, setClientError] = React.useState("");
  React.useEffect(() => {
    if (open) { setReason(""); setClientError(""); task.reset(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const serverReason = fieldErrorsOf(task.error).reason;
  const error = clientError || serverReason;

  const submit = async () => {
    if (!reason.trim()) { setClientError("Say why the order is being cancelled — it is recorded in the order history."); return; }
    setClientError("");
    const data = await task.run(() => call("cancel/", { reason: reason.trim() }));
    if (data) { onOpenChange(false); onDone?.(data); }
  };

  return (
    <ConfirmDialog open={open} onOpenChange={(o) => { if (!task.busy) onOpenChange(o); }} danger loading={task.busy} confirmLabel="Cancel this order"
      title={`Cancel order ${order.number}?`} description="This can't be undone. To keep the order as it is, close this window with ‘Cancel’ or Esc." onConfirm={submit}>
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-ink">What will happen</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink-2">{cancelConsequences(order, money).map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
        <Field label="Reason for cancelling" htmlFor="cancel-reason" required error={error} hint={`Shown to colleagues in the history, up to ${MAX_REASON} characters.`}>
          <Textarea id="cancel-reason" value={reason} maxLength={MAX_REASON} aria-invalid={!!error} aria-describedby={describedBy("cancel-reason", true, !!error)} onChange={(e) => { setReason(e.target.value); setClientError(""); }} />
        </Field>
        {task.error != null && !serverReason && <ErrorAlert error={task.error} />}
      </div>
    </ConfirmDialog>
  );
}

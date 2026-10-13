"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { adminRequest, useAdminAction } from "@/lib/admin";
import { useMoneyIn } from "./format";
import { serverFormErrors } from "./server-errors";

export const FINANCE_INVALIDATE = ["/payments", "/orders", "/finance", "/dashboard", "/reports"];

/**
 * Cash-on-delivery and "manual" refunds stay PENDING until a person confirms the money was handed back and records a
 * reference (POST /orders/{number}/refunds/{id}/complete/). Nothing is marked refunded before that.
 */
export function ManualRefundDialog({ order, refundId, amount, currency, onClose }: { order: string; refundId: number; amount: string; currency?: string; onClose: () => void }) {
  const money = useMoneyIn();
  const [reference, setReference] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const run = useAdminAction(
    (ref: string) => adminRequest("POST", `/orders/${encodeURIComponent(order)}/refunds/${refundId}/complete/`, { reference: ref }),
    { invalidate: FINANCE_INVALIDATE, success: "Handover recorded — the refund is now completed.", onSuccess: onClose },
  );
  const errors = serverFormErrors(run.error, ["reference"]);
  const missing = touched && !reference.trim() ? "Enter the receipt number or reference for the money you handed back." : undefined;
  const refError = missing ?? errors.fields.reference;
  return (
    <Dialog open onOpenChange={(o) => !o && !run.isPending && onClose()}>
      <DialogContent title="Record manual refund" description={`Confirm that ${money(amount, currency)} was handed back to the customer for order ${order}.`}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (reference.trim() && !run.isPending) run.mutate(reference.trim());
          }}
          className="space-y-4"
        >
          <Alert tone="warn" title="Only record this once the money has really been returned">
            The refund is marked completed and the payment&apos;s refunded amount goes up straight away. This can&apos;t be undone from here.
          </Alert>
          <Field label="Receipt number or reference" htmlFor="manual-ref" required error={refError} hint="For example the till receipt number or the credit-note number.">
            <Input id="manual-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} aria-invalid={!!refError} aria-describedby={describedBy("manual-ref", true, !!refError)} autoFocus />
          </Field>
          {errors.form && <Alert tone="bad">{errors.form}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={run.isPending}>Cancel</Button>
            <Button type="submit" loading={run.isPending}>Record handover</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

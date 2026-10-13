"use client";

import { useQueryClient } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import * as React from "react";
import { FormDialog, useFormAction } from "@/components/admin/inventory/form-kit";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ApiError, newIdempotencyKey } from "@/lib/api";
import { adminRequest, isoDate } from "@/lib/admin";
import { formatQty } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { trimDec } from "./decimal";
import { buildReceivePayload, overReceipt, rowsFromLines, validateReceive, type ReceiveRow } from "./receive-logic";
import type { PurchaseOrder } from "./types";

/**
 * Record a delivery against a purchase order. Every attempt carries one idempotency key (made when the dialog opens and
 * reused for every retry of that attempt), so pressing Save twice or retrying after a dropped connection can never put
 * the same delivery on the shelf twice. If the server recognises the key it answers “already received” and we say so.
 */
export function ReceiveDialog({ po, onClose, onReplayed }: { po: PurchaseOrder; onClose: () => void; onReplayed: (receiptNumber: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const money = useMoney();
  const [key] = React.useState(() => newIdempotencyKey());
  const [rows, setRows] = React.useState<ReceiveRow[]>(() => rowsFromLines(po.lines));
  const [deliveryNote, setDeliveryNote] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const hidden = po.lines.length - rows.length;
  const today = isoDate(new Date());

  const { mutation, message, fieldErrors, clear } = useFormAction(
    (body: ReturnType<typeof buildReceivePayload>) => adminRequest<PurchaseOrder>("POST", `/purchase-orders/${po.id}/receive/`, body),
    {
      invalidate: ["/purchase-orders", "/inventory", "/suppliers"],
      success: (d) => (d.receipt?.replayed ? undefined : `Delivery recorded as ${d.receipt?.number}. ${d.number} is now ${d.status_label.toLowerCase()}.`),
      onSuccess: (d) => {
        if (d.receipt?.replayed) {
          toast.info("Already received", `Receipt ${d.receipt.number} was recorded earlier. Nothing was added twice.`);
          onReplayed(d.receipt.number);
        }
        onClose();
      },
      onError: (e) => {
        const code = e instanceof ApiError ? e.code : "";
        // The order may have changed under us (someone else received it): refresh what the page shows.
        if (code === "DUPLICATE_RECEIPT" || code === "INVALID_STATE") qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "admin" && String(q.queryKey[1] ?? "").startsWith("/purchase-orders") });
      },
    },
  );

  const check = validateReceive(rows);
  const patch = (i: number, p: Partial<ReceiveRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const submit = () => {
    setTouched(true);
    if (check.formError || Object.keys(check.errors).length) return;
    mutation.mutate(buildReceivePayload({ key, deliveryNote, notes, rows }, check.active));
  };
  const err = (i: number, f: string) => (touched ? check.errors[`${i}.${f}`] : undefined);

  return (
    <FormDialog onClose={onClose} onEdit={clear} wide title={`Receive goods for ${po.number}`} description="Enter what actually arrived. Accepted units go onto the shelf; rejected units are recorded but not added to stock."
      submitLabel="Record delivery" submitDisabled={!rows.length} onSubmit={submit} loading={mutation.isPending} message={message}
      footerNote={<span>Protected against double entry by receiving key <code className="font-mono">{key.slice(0, 8)}…</code></span>}>
      {!rows.length ? <Alert tone="info">Every line on this order has already been received in full.</Alert> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Delivery note number (optional)" htmlFor="rcv-dn" error={fieldErrors.delivery_note}><Input id="rcv-dn" maxLength={120} value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} /></Field>
            <Field label="Notes (optional)" htmlFor="rcv-notes" error={fieldErrors.notes}><Textarea id="rcv-notes" className="min-h-11" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <ul className="space-y-3">
            {rows.map((r, i) => {
              const over = overReceipt(r.outstanding, r.accepted.trim());
              const rej = r.rejected.trim() !== "" && Number(r.rejected) > 0;
              const acc = r.accepted.trim() !== "" && Number(r.accepted) > 0;
              const pastDate = !!r.expiry && r.expiry < today;
              const id = (f: string) => `rcv-${r.poLineId}-${f}`;
              const pos = check.active.indexOf(i); // the server numbers only the lines we sent
              const lineErr = (f: string, apiField: string) => (pos >= 0 ? fieldErrors[`lines.${pos}.${apiField}`] : undefined) ?? err(i, f);
              return (
                <li key={r.poLineId}>
                  <fieldset className="rounded-md border border-line bg-white p-3">
                    <legend className="px-1 text-sm font-semibold text-ink">{r.name} <span className="font-normal text-ink-3">· {r.sku}</span></legend>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="num text-xs text-ink-2">Ordered {formatQty(r.ordered, r.unit)} · received so far {formatQty(r.received)} · <strong>outstanding {formatQty(r.outstanding, r.unit)}</strong> · {money(r.unitCost)} each (price on the order)</p>
                      <Button variant="ghost" size="sm" onClick={() => patch(i, { accepted: trimDec(r.outstanding) })}>Use outstanding</Button>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <Field label={`Accepted (${r.unit})`} htmlFor={id("acc")} error={lineErr("accepted", "qty_accepted")}>
                        <Input id={id("acc")} inputMode="decimal" autoComplete="off" value={r.accepted} onChange={(e) => patch(i, { accepted: e.target.value })} aria-invalid={!!lineErr("accepted", "qty_accepted") || undefined} aria-describedby={describedBy(id("acc"), false, !!lineErr("accepted", "qty_accepted"))} />
                      </Field>
                      <Field label={`Rejected (${r.unit})`} htmlFor={id("rej")} error={lineErr("rejected", "qty_rejected")}>
                        <Input id={id("rej")} inputMode="decimal" autoComplete="off" value={r.rejected} onChange={(e) => patch(i, { rejected: e.target.value })} aria-invalid={!!lineErr("rejected", "qty_rejected") || undefined} aria-describedby={describedBy(id("rej"), false, !!lineErr("rejected", "qty_rejected"))} />
                      </Field>
                      {rej && (
                        <Field label="Why rejected" htmlFor={id("why")} required error={lineErr("rejectReason", "reject_reason")}>
                          <Input id={id("why")} maxLength={200} value={r.rejectReason} onChange={(e) => patch(i, { rejectReason: e.target.value })} aria-invalid={!!lineErr("rejectReason", "reject_reason") || undefined} aria-describedby={describedBy(id("why"), false, !!lineErr("rejectReason", "reject_reason"))} />
                        </Field>
                      )}
                    </div>
                    {over && <p role="status" className="mt-2 text-xs font-medium text-warn">{trimDec(over)} {r.unit} more than outstanding. Suppliers may ship up to 10% over; anything beyond that is refused.</p>}
                    {r.tracksBatches && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <Field label="Lot code" htmlFor={id("lot")} required={acc} error={lineErr("lot", "lot_code")}>
                          <Input id={id("lot")} maxLength={60} autoComplete="off" value={r.lot} onChange={(e) => patch(i, { lot: e.target.value })} aria-invalid={!!lineErr("lot", "lot_code") || undefined} aria-describedby={describedBy(id("lot"), false, !!lineErr("lot", "lot_code"))} />
                        </Field>
                        <Field label="Expiry date" htmlFor={id("exp")} required={acc} error={lineErr("expiry", "expiry_date")} hint={pastDate ? "This date has already passed, so the batch will arrive expired." : undefined}>
                          <Input id={id("exp")} type="date" value={r.expiry} onChange={(e) => patch(i, { expiry: e.target.value })} aria-invalid={!!lineErr("expiry", "expiry_date") || undefined} aria-describedby={describedBy(id("exp"), pastDate, !!lineErr("expiry", "expiry_date"))} />
                        </Field>
                        <Field label="Date means" htmlFor={id("kind")} error={fieldErrors[`lines.${i}.expiry_kind`]}>
                          <Select id={id("kind")} value={r.expiryKind} onChange={(e) => patch(i, { expiryKind: e.target.value as ReceiveRow["expiryKind"] })}>
                            <option value="BEST_BEFORE">Best before</option>
                            <option value="USE_BY">Use by</option>
                          </Select>
                        </Field>
                      </div>
                    )}
                  </fieldset>
                </li>
              );
            })}
          </ul>
          {hidden > 0 && <p className="text-xs text-ink-3">{hidden} {hidden === 1 ? "line" : "lines"} already received in full {hidden === 1 ? "is" : "are"} not shown.</p>}
          {touched && check.formError && <p role="alert" className="text-sm font-medium text-bad">{check.formError}</p>}
        </>
      )}
    </FormDialog>
  );
}

export function ReceiveButton({ onClick }: { onClick: () => void }) {
  return <Button onClick={onClick}><PackageCheck className="size-4" aria-hidden /> Receive goods</Button>;
}

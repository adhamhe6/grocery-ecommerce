"use client";

// Adjust stock, record waste, transfer between stores, edit thresholds. Each submits to its own endpoint, shows the
// server's message verbatim and can't be double-submitted (the button is disabled while the request is in flight).
import * as React from "react";
import { Alert } from "@/components/ui/states";
import { ChoiceGroup, Field, Input, Select, Textarea, describedBy } from "@/components/ui/field";
import { adminRequest, useAdmin } from "@/lib/admin";
import { formatQty } from "@/lib/format";
import { cmpDec, trimDec } from "@/components/admin/purchasing/decimal";
import { BatchSelect, useProductBatches } from "./batch-select";
import { FormDialog, useFormAction } from "./form-kit";
import { adjustPayload, batchFree, previewAdjust, signed, transferPayload, validateQty, wastePayload, type AdjustMode } from "./stock-math";
import { WASTE_REASONS, type BatchRow, type StockRow } from "./types";

/** What a stock dialog acts on: one product at one store. Level quantities are absent when opened from a batch. */
export interface StockTarget {
  productId: number;
  name: string;
  sku: string;
  unit: string;
  tracksBatches: boolean;
  branchId: number;
  branchName: string;
  onHand?: string;
  reserved?: string;
  available?: string;
}

export const targetFromStock = (r: StockRow): StockTarget => ({
  productId: r.product_id, name: r.name, sku: r.sku, unit: r.unit, tracksBatches: r.tracks_batches, branchId: r.branch_id, branchName: r.branch,
  onHand: r.on_hand, reserved: r.reserved, available: r.available,
});

export const targetFromBatch = (b: BatchRow): StockTarget => ({
  productId: b.product_id, name: b.name, sku: b.sku, unit: b.unit, tracksBatches: true, branchId: b.branch_id, branchName: b.branch,
});

function Heading({ t }: { t: StockTarget }) {
  return (
    <p className="rounded-md bg-paper-2 px-3 py-2 text-sm">
      <span className="font-semibold">{t.name}</span> <span className="text-ink-3">· {t.sku} · {t.branchName}</span>
      {t.onHand !== undefined && <span className="num mt-0.5 block text-ink-2">{formatQty(t.onHand, t.unit)} on hand, {formatQty(t.reserved ?? "0", t.unit)} reserved for orders</span>}
    </p>
  );
}

const INVENTORY = ["/inventory/"];

// ------------------------------------------------------------------------------------------------ adjust
export function AdjustDialog({ target, onClose }: { target: StockTarget; onClose: () => void }) {
  const [mode, setMode] = React.useState<AdjustMode>("target");
  const [value, setValue] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [batchId, setBatchId] = React.useState<number | null>(null);
  const [touched, setTouched] = React.useState(false);
  const { batches, isLoading: batchesLoading } = useProductBatches(target.productId, target.branchId, target.tracksBatches);
  const batch = batches.find((b) => b.id === batchId) ?? null;

  const current = target.tracksBatches ? batch?.qty_remaining : target.onHand;
  const reserved = target.tracksBatches ? batch?.qty_reserved : target.reserved;
  const preview = current !== undefined && reserved !== undefined ? previewAdjust(current, reserved, mode, value) : null;

  const { mutation, message, fieldErrors, clear } = useFormAction(
    (body: ReturnType<typeof adjustPayload>) => adminRequest<{ changed: boolean; on_hand_after: string | null }>("POST", "/inventory/adjust/", body),
    {
      invalidate: INVENTORY,
      success: (d) => (d.changed ? `Stock adjusted: ${target.name} now ${formatQty(d.on_hand_after, target.unit)} on hand at ${target.branchName}.` : "No change: the count already matches the system."),
      onSuccess: onClose,
    },
  );

  const errors = {
    batch: target.tracksBatches && !batchId ? "Choose the batch you counted." : undefined,
    value: !value.trim() ? "Enter a quantity." : preview && !preview.valid ? preview.error : undefined,
    reason: !reason.trim() ? "A reason is required for every adjustment." : undefined,
  };
  const submit = () => {
    setTouched(true);
    if (errors.batch || errors.value || errors.reason) return;
    mutation.mutate(adjustPayload({ productId: target.productId, branchId: target.branchId, batchId, mode, value, reason, note }));
  };
  const show = (k: keyof typeof errors, server?: string) => server ?? (touched ? errors[k] : undefined);

  return (
    <FormDialog onClose={onClose} onEdit={clear} title="Adjust stock" description="Correct the system count after a stock take. Every adjustment is recorded in the movement ledger with your name and reason." submitLabel="Save adjustment" onSubmit={submit} loading={mutation.isPending} message={message}>
      <Heading t={target} />
      {target.tracksBatches && <BatchSelect id="adj-batch" batches={batches} loading={batchesLoading} value={batchId} onChange={setBatchId} error={show("batch", fieldErrors.batch_id)} hint="Batch-tracked products are adjusted one batch at a time." />}
      <ChoiceGroup name="adj-mode" legend="How do you want to enter it?" value={mode} onChange={(m) => { setMode(m); setValue(""); }} options={[
        { value: "target", title: "I counted this many", description: "Set the quantity on hand to what you counted." },
        { value: "delta", title: "Add or remove", description: "Enter a change, for example 5 or -2." },
      ]} />
      <Field label={mode === "target" ? `Counted quantity (${target.unit})` : `Change (${target.unit})`} htmlFor="adj-value" required error={show("value", fieldErrors.target ?? fieldErrors.delta)}>
        <Input id="adj-value" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!show("value", fieldErrors.target ?? fieldErrors.delta) || undefined} aria-describedby={describedBy("adj-value", false, !!show("value", fieldErrors.target ?? fieldErrors.delta))} />
      </Field>
      {preview?.valid && (
        <div role="status" className="rounded-md border border-line bg-white px-3 py-2 text-sm">
          <span className="text-ink-2">After this adjustment: </span><strong className="num">{formatQty(preview.result, target.unit)}</strong>
          <span className="num text-ink-3"> ({preview.noChange ? "no change" : `${signed(preview.change!)} ${target.unit}`}{target.tracksBatches ? ", in this batch" : ""})</span>
        </div>
      )}
      {preview?.valid && preview.belowReserved && (
        <Alert tone="warn" title="Below what is reserved">{formatQty(reserved, target.unit)} {target.unit} {target.tracksBatches ? "in this batch is" : "is"} reserved for customer orders. The system will refuse to go below that.</Alert>
      )}
      <Field label="Reason" htmlFor="adj-reason" required error={show("reason", fieldErrors.reason)} hint="For example: monthly stock take, found on shelf, damaged in storage.">
        <Input id="adj-reason" maxLength={120} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!show("reason", fieldErrors.reason) || undefined} aria-describedby={describedBy("adj-reason", true, !!show("reason", fieldErrors.reason))} />
      </Field>
      <Field label="Note (optional)" htmlFor="adj-note" error={fieldErrors.note}>
        <Textarea id="adj-note" className="min-h-16" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------------------ waste
export function WasteDialog({ target, onClose, initial }: { target: StockTarget; onClose: () => void; initial?: { batchId?: number; quantity?: string; reason?: string } }) {
  const [reason, setReason] = React.useState(initial?.reason ?? "");
  const [quantity, setQuantity] = React.useState(initial?.quantity ?? "");
  const [note, setNote] = React.useState("");
  const [batchId, setBatchId] = React.useState<number | null>(initial?.batchId ?? null);
  const [touched, setTouched] = React.useState(false);
  const { batches, isLoading: batchesLoading } = useProductBatches(target.productId, target.branchId, target.tracksBatches);
  const batch = batches.find((b) => b.id === batchId) ?? null;

  // What can be written off: expired and quarantined batches may go even when stale reservations remain (the server allows it).
  const max = target.tracksBatches
    ? batch ? (batch.status === "EXPIRED" || batch.status === "QUARANTINED" ? batch.qty_remaining : batchFree(batch)) : undefined
    : target.available;
  const maxLabel = target.tracksBatches ? "that can be written off from this batch" : "available (not reserved for orders)";

  const { mutation, message, fieldErrors, clear } = useFormAction(
    (body: ReturnType<typeof wastePayload>) => adminRequest<{ on_hand_after: string }>("POST", "/inventory/waste/", body),
    { invalidate: INVENTORY, success: (d) => `Waste recorded: ${target.name} now ${formatQty(d.on_hand_after, target.unit)} on hand at ${target.branchName}.`, onSuccess: onClose },
  );

  const errors = {
    reason: !reason ? "Choose why the stock is being written off." : undefined,
    batch: target.tracksBatches && !batchId ? "Choose the batch the waste came from." : undefined,
    quantity: validateQty(quantity, { max, maxLabel }) ?? undefined,
  };
  const submit = () => {
    setTouched(true);
    if (errors.reason || errors.batch || errors.quantity) return;
    mutation.mutate(wastePayload({ productId: target.productId, branchId: target.branchId, batchId, quantity, reason, note }));
  };
  const show = (k: keyof typeof errors, server?: string) => server ?? (touched ? errors[k] : undefined);

  return (
    <FormDialog onClose={onClose} onEdit={clear} title="Record waste" description="Write stock off the shelf. The quantity is removed from on hand and a waste movement is recorded. It can't be edited later; corrections are new adjustments." submitLabel="Record waste" danger onSubmit={submit} loading={mutation.isPending} message={message}>
      <Heading t={target} />
      {target.tracksBatches && <BatchSelect id="waste-batch" batches={batches} loading={batchesLoading} value={batchId} onChange={(id) => { setBatchId(id); }} error={show("batch", fieldErrors.batch_id)} hint="Choose the batch the waste came from." />}
      <Field label="Reason" htmlFor="waste-reason" required error={show("reason", fieldErrors.reason_code)}>
        <Select id="waste-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!show("reason", fieldErrors.reason_code) || undefined}>
          <option value="">Choose a reason</option>
          {WASTE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label={`Quantity (${target.unit})`} htmlFor="waste-qty" required error={show("quantity", fieldErrors.quantity)}
        hint={max !== undefined ? <>Up to <span className="num">{trimDec(max)}</span> {maxLabel}.{batch && (batch.status === "EXPIRED" || batch.status === "QUARANTINED") ? " Expired and blocked batches can be written off in full." : ""}</> : undefined}>
        <Input id="waste-qty" inputMode="decimal" autoComplete="off" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!show("quantity", fieldErrors.quantity) || undefined} aria-describedby={describedBy("waste-qty", max !== undefined, !!show("quantity", fieldErrors.quantity))} />
      </Field>
      <Field label="Note (optional)" htmlFor="waste-note" error={fieldErrors.note}>
        <Textarea id="waste-note" className="min-h-16" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------------------ transfer
export function TransferDialog({ target, onClose }: { target: StockTarget; onClose: () => void }) {
  const { branches } = useAdmin();
  const destinations = branches.filter((b) => b.id !== target.branchId);
  const [to, setTo] = React.useState<number | null>(destinations.length === 1 ? destinations[0].id : null);
  const [quantity, setQuantity] = React.useState("");
  const [note, setNote] = React.useState("");
  const [batchId, setBatchId] = React.useState<number | null>(null);
  const [touched, setTouched] = React.useState(false);
  const { batches, isLoading: batchesLoading } = useProductBatches(target.productId, target.branchId, target.tracksBatches);
  const batch = batches.find((b) => b.id === batchId) ?? null;
  const max = target.tracksBatches ? (batch ? batchFree(batch) : undefined) : target.available;
  const maxLabel = target.tracksBatches ? "unreserved in this batch" : "available to transfer";

  const { mutation, message, fieldErrors, clear } = useFormAction(
    (body: ReturnType<typeof transferPayload>) => adminRequest("POST", "/inventory/transfer/", body),
    { invalidate: INVENTORY, success: () => `Transferred ${quantity.trim()} ${target.unit} of ${target.name} to ${branches.find((b) => b.id === to)?.name ?? "the other store"}.`, onSuccess: onClose },
  );

  const errors = {
    to: !to ? "Choose where the stock is going." : undefined,
    batch: target.tracksBatches && !batchId ? "Choose the batch to move." : undefined,
    quantity: validateQty(quantity, { max, maxLabel }) ?? undefined,
  };
  const submit = () => {
    setTouched(true);
    if (errors.to || errors.batch || errors.quantity || !to) return;
    mutation.mutate(transferPayload({ productId: target.productId, fromBranchId: target.branchId, toBranchId: to, batchId, quantity, note }));
  };
  const show = (k: keyof typeof errors, server?: string) => server ?? (touched ? errors[k] : undefined);

  return (
    <FormDialog onClose={onClose} onEdit={clear} title="Transfer stock" description="Moves stock between stores immediately; there is no in-transit state. Batches keep their lot code and expiry date." submitLabel="Transfer" onSubmit={submit} loading={mutation.isPending} message={message}>
      <Heading t={target} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From" htmlFor="tr-from"><Input id="tr-from" readOnly value={target.branchName} /></Field>
        <Field label="To" htmlFor="tr-to" required error={show("to", fieldErrors.to_branch_id)}>
          <Select id="tr-to" value={to ?? ""} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : null)} aria-invalid={!!show("to", fieldErrors.to_branch_id) || undefined}>
            <option value="">Choose a store</option>
            {destinations.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
      </div>
      {!destinations.length && <Alert tone="warn" title="No other store">Your account can only see this store, so there is nowhere to transfer to. A transfer needs access to both stores.</Alert>}
      {target.tracksBatches && <BatchSelect id="tr-batch" batches={batches} loading={batchesLoading} value={batchId} onChange={setBatchId} error={show("batch", fieldErrors.batch_id)} hint="Choose the batch to move." />}
      <Field label={`Quantity (${target.unit})`} htmlFor="tr-qty" required error={show("quantity", fieldErrors.quantity)}
        hint={max !== undefined ? <>Up to <span className="num">{trimDec(max)}</span> {maxLabel}.</> : undefined}>
        <Input id="tr-qty" inputMode="decimal" autoComplete="off" value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!show("quantity", fieldErrors.quantity) || undefined} aria-describedby={describedBy("tr-qty", max !== undefined, !!show("quantity", fieldErrors.quantity))} />
      </Field>
      <Field label="Note (optional)" htmlFor="tr-note" error={fieldErrors.note}>
        <Textarea id="tr-note" className="min-h-16" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------------------ thresholds
export function ThresholdDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [low, setLow] = React.useState(trimDec(row.low_stock_threshold));
  const [reorder, setReorder] = React.useState(trimDec(row.reorder_quantity));
  const [touched, setTouched] = React.useState(false);
  const { mutation, message, fieldErrors, clear } = useFormAction(
    (body: { low_stock_threshold: string; reorder_quantity: string }) => adminRequest("PATCH", `/inventory/stock/${row.id}/thresholds/`, body),
    { invalidate: INVENTORY, success: "Thresholds saved.", onSuccess: onClose },
  );
  const errors = {
    low: validateQty(low, { allowZero: true }) ?? undefined,
    reorder: validateQty(reorder, { allowZero: true }) ?? undefined,
  };
  const submit = () => {
    setTouched(true);
    if (errors.low || errors.reorder) return;
    mutation.mutate({ low_stock_threshold: low.trim(), reorder_quantity: reorder.trim() });
  };
  const changed = cmpDec(low, row.low_stock_threshold) !== 0 || cmpDec(reorder, row.reorder_quantity) !== 0;
  return (
    <FormDialog onClose={onClose} onEdit={clear} title="Stock thresholds" description={`${row.name} at ${row.branch}. A line is “low” when available stock is at or below the threshold; 0 turns the low-stock warning off.`} submitLabel="Save thresholds" onSubmit={submit} loading={mutation.isPending} message={message} submitDisabled={!changed && touched}>
      <Field label={`Low-stock threshold (${row.unit})`} htmlFor="th-low" error={fieldErrors.low_stock_threshold ?? (touched ? errors.low : undefined)} hint={`Currently ${trimDec(row.low_stock_threshold)}.`}>
        <Input id="th-low" inputMode="decimal" value={low} onChange={(e) => setLow(e.target.value)} />
      </Field>
      <Field label={`Reorder quantity (${row.unit})`} htmlFor="th-reorder" error={fieldErrors.reorder_quantity ?? (touched ? errors.reorder : undefined)}
        hint="Used by Replenishment: the suggested order is the larger of this and twice the threshold minus what is available.">
        <Input id="th-reorder" inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value)} />
      </Field>
    </FormDialog>
  );
}


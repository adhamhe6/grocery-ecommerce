"use client";

import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import * as React from "react";
import { Field, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { adminRequest, useAdmin } from "@/lib/admin";
import { trimDec } from "@/components/admin/purchasing/decimal";
import { batchActionPayload, batchActions, isWriteOffCandidate, type BatchAction } from "./expiry";
import { FormDialog, ToneBadge, useFormAction, type MenuAction } from "./form-kit";
import { WasteDialog, targetFromBatch } from "./stock-dialogs";
import type { BatchRow, QualityStatus } from "./types";

const COPY: Record<BatchAction, { title: string; verb: string; body: string; danger?: boolean; done: string }> = {
  quarantine: { title: "Quarantine batch", verb: "Quarantine", done: "Batch quarantined.", body: "The batch is blocked from new orders straight away, for example during a supplier recall or an inspection. The stock stays on hand and you can release it again later." },
  release: { title: "Release batch", verb: "Release", done: "Batch released.", body: "Puts the batch back on sale, as long as it has passed its quality check and is still inside its sellable date." },
  fail: { title: "Fail quality check", verb: "Mark as failed", danger: true, done: "Batch marked as failed quality.", body: "A batch that fails quality is never sold or allocated to orders. Its stock stays on hand until you write it off as waste. If this was a mistake you can mark it as passed again." },
  pass: { title: "Mark quality as passed", verb: "Mark as passed", done: "Batch marked as passed.", body: "Records that the batch passed inspection. It can be sold if it is also active and inside its sellable date." },
};

function StatusDialog({ batch, action, onClose }: { batch: BatchRow; action: BatchAction; onClose: () => void }) {
  const [note, setNote] = React.useState("");
  const copy = COPY[action];
  const { mutation, message, fieldErrors, clear } = useFormAction(
    (body: ReturnType<typeof batchActionPayload>) => adminRequest("POST", `/inventory/batches/${batch.id}/status/`, body),
    { invalidate: ["/inventory/"], success: copy.done, onSuccess: onClose },
  );
  return (
    <FormDialog onClose={onClose} onEdit={clear} title={copy.title} description={`${batch.name} · lot ${batch.lot_code} · ${batch.branch}`} submitLabel={copy.verb} danger={copy.danger}
      onSubmit={() => mutation.mutate(batchActionPayload(action, note))} loading={mutation.isPending} message={message}>
      <p className="text-sm text-ink-2">{copy.body}</p>
      <Field label="Note (optional)" htmlFor="batch-note" error={fieldErrors.note} hint="Saved with the audit log entry. Up to 200 characters.">
        <Textarea id="batch-note" className="min-h-16" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

/** Row-menu actions and dialogs for batches, shared by the expiry board and the batch table. */
export function useBatchActions() {
  const { can } = useAdmin();
  const [status, setStatus] = React.useState<{ batch: BatchRow; action: BatchAction } | null>(null);
  const [waste, setWaste] = React.useState<BatchRow | null>(null);

  const menuFor = React.useCallback((b: BatchRow): MenuAction[] => {
    const allowed = new Set(batchActions(b));
    const canStatus = can("inventory.batches");
    return [
      { label: "Quarantine…", hidden: !canStatus || !allowed.has("quarantine"), onSelect: () => setStatus({ batch: b, action: "quarantine" }) },
      { label: "Release to sale…", hidden: !canStatus || !allowed.has("release"), onSelect: () => setStatus({ batch: b, action: "release" }) },
      { label: "Fail quality check…", hidden: !canStatus || !allowed.has("fail"), onSelect: () => setStatus({ batch: b, action: "fail" }) },
      { label: "Mark quality as passed…", hidden: !canStatus || !allowed.has("pass"), onSelect: () => setStatus({ batch: b, action: "pass" }) },
      { label: "Write off as waste…", danger: true, hidden: !can("inventory.waste") || !isWriteOffCandidate(b), onSelect: () => setWaste(b) },
    ];
  }, [can]);

  const dialogs = (
    <>
      {status && <StatusDialog batch={status.batch} action={status.action} onClose={() => setStatus(null)} />}
      {waste && <WasteDialog target={targetFromBatch(waste)} initial={{ batchId: waste.id, quantity: trimDec(waste.qty_remaining), reason: "EXPIRED" }} onClose={() => setWaste(null)} />}
    </>
  );
  return { menuFor, dialogs };
}

// ------------------------------------------------------------------------------------------------ small displays
export function BatchStatusBadge({ batch }: { batch: Pick<BatchRow, "status" | "can_sell"> }) {
  const s = batch.status;
  if (s === "ACTIVE") return <ToneBadge tone="ok" icon={CheckCircle2}>Active</ToneBadge>;
  if (s === "QUARANTINED") return <ToneBadge tone="warn" icon={ShieldAlert}>Quarantined</ToneBadge>;
  if (s === "EXPIRED") return <ToneBadge tone="bad" icon={XCircle}>Expired</ToneBadge>;
  return <ToneBadge tone="neutral">Used up</ToneBadge>;
}

export function QualityBadge({ quality }: { quality: QualityStatus }) {
  if (quality === "PASSED") return <ToneBadge tone="ok" icon={CheckCircle2}>Passed</ToneBadge>;
  if (quality === "FAILED") return <ToneBadge tone="bad" icon={XCircle}>Failed</ToneBadge>;
  return <ToneBadge tone="warn" icon={AlertTriangle}>Inspection pending</ToneBadge>;
}

export function ExpiredExplainer() {
  return (
    <Alert tone="info" title="Expired batches stay on hand until you write them off">
      Passing its date marks a batch as expired and stops it being sold, but the units still count in the store’s on-hand stock until someone records them as waste. Use <strong>Write off as waste</strong> on an expired batch to remove them and record the loss.
    </Alert>
  );
}

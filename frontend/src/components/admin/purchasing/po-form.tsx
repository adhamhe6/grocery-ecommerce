"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { ProductPicker, useFormAction } from "@/components/admin/inventory/form-kit";
import { AdminPage, Card } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select, Textarea, describedBy } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { adminRequest, useAdmin, useAdminGet, useAdminList } from "@/lib/admin";
import { useMoney } from "@/lib/hooks";
import { blankLine, costInputText, createPayload, editPayload, lineAmount, totalOf, validateLines, type LineDraft } from "./po-logic";
import type { PurchaseOrder, Supplier, SupplierProductRow } from "./types";

// ------------------------------------------------------------------------------------------------ lines editor
function LinesEditor({ lines, onChange, errors, serverErrors, catalogue }: {
  lines: LineDraft[]; onChange: (l: LineDraft[]) => void; errors: Record<string, string>; serverErrors: Record<string, string>; catalogue: Map<number, string | null>;
}) {
  const money = useMoney();
  const patch = (key: string, p: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...p } : l)));
  return (
    <div className="space-y-3">
      <ol className="space-y-3">
        {lines.map((l, i) => {
          const eProduct = serverErrors[`lines.${i}.product_id`] ?? errors[`${i}.product`];
          const eQty = serverErrors[`lines.${i}.qty_ordered`] ?? errors[`${i}.qty`];
          const eCost = serverErrors[`lines.${i}.unit_cost`] ?? errors[`${i}.cost`];
          const amount = lineAmount(l);
          const fromCatalogue = !!l.product && catalogue.get(l.product.id) != null && l.unitCost === costInputText(catalogue.get(l.product.id)!);
          return (
            <li key={l.key} className="rounded-md border border-line bg-paper/60 p-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-start">
                <ProductPicker id={`po-line-${l.key}-product`} label={`Product (line ${i + 1})`} value={l.product} error={eProduct}
                  exclude={lines.filter((x) => x.key !== l.key && x.product).map((x) => x.product!.id)}
                  onChange={(p) => patch(l.key, {
                    product: p,
                    ...(p && !l.unitCost.trim() && catalogue.get(p.id) != null ? { unitCost: costInputText(catalogue.get(p.id)!) } : {}),
                  })} />
                <Field label="Quantity" htmlFor={`po-line-${l.key}-qty`} error={eQty}>
                  <Input id={`po-line-${l.key}-qty`} inputMode="decimal" autoComplete="off" value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} aria-invalid={eQty ? true : undefined} aria-describedby={describedBy(`po-line-${l.key}-qty`, false, !!eQty)} />
                </Field>
                <Field label="Unit cost" htmlFor={`po-line-${l.key}-cost`} error={eCost} hint={fromCatalogue ? "From catalogue" : undefined}>
                  <Input id={`po-line-${l.key}-cost`} inputMode="decimal" autoComplete="off" value={l.unitCost} onChange={(e) => patch(l.key, { unitCost: e.target.value })} aria-invalid={eCost ? true : undefined} aria-describedby={describedBy(`po-line-${l.key}-cost`, fromCatalogue, !!eCost)} />
                </Field>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-ink">Line total</p>
                  <output className="num flex h-11 items-center text-[0.95rem] font-semibold text-ink" aria-label={`Line ${i + 1} total`}>{amount ? money(amount) : "—"}</output>
                </div>
                <div className="md:pt-[1.65rem]">
                  <Button variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}><Trash2 className="size-4" aria-hidden /></Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <Button variant="secondary" size="sm" onClick={() => onChange([...lines, blankLine()])}><Plus className="size-4" aria-hidden /> Add {lines.length ? "another product" : "a product"}</Button>
    </div>
  );
}

function Totals({ lines }: { lines: LineDraft[] }) {
  const money = useMoney();
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3">
      <p className="text-sm text-ink-3">{lines.length} {lines.length === 1 ? "line" : "lines"}. Worked out exactly from the quantities and costs above, then rounded to the cent once.</p>
      <p className="text-lg font-semibold text-ink">Order total <span className="num" aria-live="polite">{money(totalOf(lines))}</span></p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ create
export function NewPurchaseOrder({ supplierId, branchId: presetBranch }: { supplierId?: number; branchId?: number }) {
  return <RequireCapability any={["purchasing.write"]}><NewPurchaseOrderInner supplierId={supplierId} presetBranch={presetBranch} /></RequireCapability>;
}

function NewPurchaseOrderInner({ supplierId: presetSupplier, presetBranch }: { supplierId?: number; presetBranch?: number }) {
  const router = useRouter();
  const { branches, branchId: headerBranch } = useAdmin();
  const suppliers = useAdminList<Supplier>("/suppliers/", { status: "ACTIVE", page_size: 100 });
  const [supplierId, setSupplierId] = React.useState<number | null>(presetSupplier ?? null);
  const [branchId, setBranchId] = React.useState<number | null>(presetBranch ?? headerBranch ?? (branches.length === 1 ? branches[0].id : null));
  const [expected, setExpected] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<LineDraft[]>(() => [blankLine()]);
  const [touched, setTouched] = React.useState(false);
  const supplier = suppliers.rows.find((s) => s.id === supplierId);
  const cat = useAdminGet<SupplierProductRow[]>(`/suppliers/${supplierId}/products/`, {}, { enabled: !!supplierId });
  const catalogue = React.useMemo(() => new Map((cat.data ?? []).map((r) => [r.product_id, r.unit_cost])), [cat.data]);

  const create = useFormAction(
    (body: ReturnType<typeof createPayload>) => adminRequest<PurchaseOrder>("POST", "/purchase-orders/", body),
    { invalidate: ["/purchase-orders"], success: (po) => `Draft ${po.number} created.`, onSuccess: (po) => router.push(`/admin/purchase-orders/${po.id}`) },
  );
  const busy = create.mutation.isPending || create.mutation.isSuccess;
  const { errors: lineErrors, formError } = validateLines(lines);
  const topErrors = {
    supplier: !supplierId ? "Choose a supplier." : undefined,
    store: !branchId ? "Choose the store the goods are delivered to." : undefined,
  };
  const submit = () => {
    setTouched(true);
    if (topErrors.supplier || topErrors.store || formError || Object.keys(lineErrors).length) return;
    create.mutation.mutate(createPayload({ supplierId, branchId, expectedDate: expected, notes, lines }));
  };
  const fe = create.fieldErrors;

  return (
    <AdminPage title="New purchase order" description="Choose a supplier and the store the goods go to, then add what you want to order. It is saved as a draft that you can edit and submit later."
      actions={<ButtonLink href="/admin/purchase-orders" variant="ghost" size="sm">Back to purchase orders</ButtonLink>}>
      <form noValidate className="space-y-6" onChange={create.clear} onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}>
        <Card title="Order details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Supplier" htmlFor="po-supplier" required error={fe.supplier_id ?? (touched ? topErrors.supplier : undefined)}
              hint={supplier ? `Usual lead time ${supplier.lead_time_days} ${supplier.lead_time_days === 1 ? "day" : "days"}.` : "Only active suppliers can receive new orders."}>
              <Select id="po-supplier" value={supplierId ?? ""} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)} disabled={suppliers.isLoading}
                aria-invalid={!!(fe.supplier_id ?? (touched ? topErrors.supplier : undefined)) || undefined}>
                <option value="">{suppliers.isLoading ? "Loading suppliers…" : "Choose a supplier"}</option>
                {suppliers.rows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Deliver to" htmlFor="po-store" required error={fe.branch_id ?? (touched ? topErrors.store : undefined)}>
              <Select id="po-store" value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)} aria-invalid={!!(fe.branch_id ?? (touched ? topErrors.store : undefined)) || undefined}>
                <option value="">Choose a store</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="Expected delivery date" htmlFor="po-expected" error={fe.expected_date} hint="Leave blank to use today plus the supplier’s lead time.">
              <Input id="po-expected" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
            </Field>
            <Field label="Notes (optional)" htmlFor="po-notes" error={fe.notes}>
              <Textarea id="po-notes" className="min-h-11" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Card>
        <Card title="Products">
          <div className="space-y-4">
            {supplierId && cat.data && !cat.data.length && <Alert tone="info">This supplier has no products linked yet, so unit costs can’t be filled in automatically. Enter them by hand, or add the products to the supplier’s catalogue.</Alert>}
            <LinesEditor lines={lines} onChange={setLines} errors={touched ? lineErrors : {}} serverErrors={fe} catalogue={catalogue} />
            {touched && formError && <p role="alert" className="text-sm font-medium text-bad">{formError}</p>}
            <Totals lines={lines} />
          </div>
        </Card>
        {create.message && <Alert tone="bad" title="The order wasn’t saved">{create.message}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <ButtonLink href="/admin/purchase-orders" variant="secondary">Cancel</ButtonLink>
          <Button type="submit" loading={busy}>Save draft</Button>
        </div>
      </form>
    </AdminPage>
  );
}

// ------------------------------------------------------------------------------------------------ edit (draft)
export function EditDraftForm({ po, onDone }: { po: PurchaseOrder; onDone: () => void }) {
  const [expected, setExpected] = React.useState(po.expected_date ?? "");
  const [notes, setNotes] = React.useState(po.notes);
  const [lines, setLines] = React.useState<LineDraft[]>(() => po.lines.map((l) => ({
    ...blankLine(), product: { id: l.product_id, sku: l.sku, name: l.name, tracks_batches: l.tracks_batches }, qty: l.qty_ordered, unitCost: costInputText(l.unit_cost),
  })));
  const [touched, setTouched] = React.useState(false);
  const cat = useAdminGet<SupplierProductRow[]>(`/suppliers/${po.supplier_id}/products/`);
  const catalogue = React.useMemo(() => new Map((cat.data ?? []).map((r) => [r.product_id, r.unit_cost])), [cat.data]);
  const save = useFormAction(
    (body: ReturnType<typeof editPayload>) => adminRequest<PurchaseOrder>("PATCH", `/purchase-orders/${po.id}/`, body),
    { invalidate: ["/purchase-orders"], success: "Draft saved.", onSuccess: onDone },
  );
  const { errors: lineErrors, formError } = validateLines(lines);
  const submit = () => {
    setTouched(true);
    if (formError || Object.keys(lineErrors).length) return;
    save.mutation.mutate(editPayload({ expectedDate: expected, notes, lines }));
  };
  const fe = save.fieldErrors;
  return (
    <form noValidate className="space-y-6" onChange={save.clear} onSubmit={(e) => { e.preventDefault(); if (!save.mutation.isPending) submit(); }}>
      <Card title="Edit draft">
        <div className="space-y-4">
          <p className="text-sm text-ink-2">The supplier ({po.supplier}) and the delivery store ({po.branch}) can’t be changed on an existing order. Cancel it and raise a new one if either is wrong.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Expected delivery date" htmlFor="edit-expected" error={fe.expected_date}><Input id="edit-expected" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
            <Field label="Notes (optional)" htmlFor="edit-notes" error={fe.notes}><Textarea id="edit-notes" className="min-h-11" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
          <LinesEditor lines={lines} onChange={setLines} errors={touched ? lineErrors : {}} serverErrors={fe} catalogue={catalogue} />
          {touched && formError && <p role="alert" className="text-sm font-medium text-bad">{formError}</p>}
          <Totals lines={lines} />
        </div>
      </Card>
      {save.message && <Alert tone="bad" title="The changes weren’t saved">{save.message}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={save.mutation.isPending}>Discard changes</Button>
        <Button type="submit" loading={save.mutation.isPending}>Save changes</Button>
      </div>
    </form>
  );
}

"use client";

import { Trash2 } from "lucide-react";
import * as React from "react";
import { ProductPicker, STICKY_ACTIONS, useFormAction, type ProductOption } from "@/components/admin/inventory/form-kit";
import { Card, DataTable, type Column } from "@/components/admin/kit";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/field";
import { adminRequest, useAdmin, useAdminGet } from "@/lib/admin";
import { useMoney } from "@/lib/hooks";
import { validateUnitCost } from "./replenishment-logic";
import type { SupplierProductRow } from "./types";

interface Draft extends SupplierProductRow { key: string; id?: number }

/**
 * The products a supplier sells, with their own SKU and agreed unit cost. This list is what Replenishment uses to decide
 * who can supply a low-stock product. Saving replaces the whole list (PUT /suppliers/{id}/products/).
 */
export function SupplierCatalogue({ supplierId }: { supplierId: number }) {
  const { can } = useAdmin();
  const canWrite = can("purchasing.write");
  const money = useMoney();
  const q = useAdminGet<SupplierProductRow[]>(`/suppliers/${supplierId}/products/`);
  const [draft, setDraft] = React.useState<Draft[] | null>(null);
  const [picker, setPicker] = React.useState<ProductOption | null>(null);
  const [touched, setTouched] = React.useState(false);
  const rows: Draft[] = draft ?? (q.data ?? []).map((r) => ({ ...r, key: String(r.product_id) }));
  const dirty = draft !== null;

  const save = useFormAction(
    (body: { product_id: number; supplier_sku: string; unit_cost: string | null }[]) => adminRequest<SupplierProductRow[]>("PUT", `/suppliers/${supplierId}/products/`, body),
    { invalidate: ["/suppliers"], success: "Supplier catalogue saved.", onSuccess: () => { setDraft(null); setTouched(false); } },
  );

  const edit = (key: string, patch: Partial<Draft>) => setDraft(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const costError = (r: Draft) => (r.unit_cost && r.unit_cost.trim() ? validateUnitCost(r.unit_cost) : null);
  const invalid = rows.some((r) => costError(r));

  const onSave = () => {
    setTouched(true);
    if (invalid) return;
    save.mutation.mutate(rows.map((r) => ({ product_id: r.product_id, supplier_sku: r.supplier_sku.trim(), unit_cost: r.unit_cost && r.unit_cost.trim() ? r.unit_cost.trim() : null })));
  };

  const columns: Column<Draft>[] = [
    { key: "product", header: "Product", cell: (r) => <div className="min-w-40"><p className="font-semibold text-ink">{r.name}</p><p className="text-xs text-ink-3">{r.sku}</p></div> },
    { key: "sku", header: "Supplier’s SKU", cell: (r) => canWrite
      ? <Input aria-label={`Supplier SKU for ${r.name}`} className="h-9 w-40 text-sm" maxLength={60} value={r.supplier_sku} onChange={(e) => edit(r.key, { supplier_sku: e.target.value })} />
      : r.supplier_sku || <span className="text-ink-3">—</span> },
    { key: "cost", header: "Unit cost", align: "right", cell: (r) => {
      if (!canWrite) return r.unit_cost ? money(r.unit_cost) : <span className="text-ink-3">Not set</span>;
      const err = touched ? costError(r) : null;
      return (
        <div className="ml-auto w-32 text-left">
          <Input aria-label={`Unit cost for ${r.name}`} inputMode="decimal" className="h-9 text-sm" value={r.unit_cost ?? ""} placeholder="Not set" aria-invalid={err ? true : undefined} aria-describedby={err ? `cost-${r.key}-err` : undefined}
            onChange={(e) => edit(r.key, { unit_cost: e.target.value })} />
          {err && <p id={`cost-${r.key}-err`} role="alert" className="mt-1 text-xs font-medium text-bad">{err}</p>}
        </div>
      );
    } },
    ...(canWrite ? [{ key: "remove", header: "Remove", className: STICKY_ACTIONS, cell: (r: Draft) => (
      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${r.name} from this supplier`} onClick={() => setDraft(rows.filter((x) => x.key !== r.key))}><Trash2 className="size-4" aria-hidden /></Button>
    ) }] : []),
  ];

  return (
    <Card title="Products this supplier sells" actions={canWrite && dirty ? (
      <>
        <Button variant="secondary" size="sm" disabled={save.mutation.isPending} onClick={() => { setDraft(null); setTouched(false); save.clear(); }}>Discard changes</Button>
        <Button size="sm" loading={save.mutation.isPending} onClick={onSave}>Save catalogue</Button>
      </>
    ) : undefined}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">Replenishment only suggests a supplier for a product if it is listed here, and uses the unit cost as the default price on new orders.</p>
        {save.message && <Alert tone="bad" title="The catalogue wasn’t saved">{save.message}</Alert>}
        {canWrite && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-96">
              <ProductPicker id="cat-add" label="Add a product" value={picker} exclude={rows.map((r) => r.product_id)}
                onChange={(p) => {
                  if (p) setDraft([...rows, { key: String(p.id), product_id: p.id, sku: p.sku, name: p.name, supplier_sku: "", unit_cost: null }]);
                  setPicker(null);
                }} />
            </div>
          </div>
        )}
        <DataTable<Draft> caption={`Products sold by this supplier${dirty ? " (unsaved changes)" : ""}`} columns={columns} rows={rows} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} rowKey={(r) => r.key}
          empty={<EmptyState title="No products linked">{canWrite ? "Search above to add the products this supplier sells." : "No products have been linked to this supplier yet."}</EmptyState>} />
        {dirty && <p role="status" className="text-sm font-medium text-warn">You have unsaved changes to this list.</p>}
      </div>
    </Card>
  );
}

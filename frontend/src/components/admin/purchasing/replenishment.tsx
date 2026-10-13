"use client";

import { PackageSearch } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { StoreSelect, useFormAction, useWorkingBranch } from "@/components/admin/inventory/form-kit";
import { AdminPage, Card, ConfirmDialog } from "@/components/admin/kit";
import { RequireCapability } from "@/components/admin/shell";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError } from "@/lib/api";
import { adminRequest, useAdmin, useAdminGet } from "@/lib/admin";
import { formatQty } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import { trimDec } from "./decimal";
import { costInputText } from "./po-logic";
import { defaultSupplier, groupBySupplier, type PlanRow } from "./replenishment-logic";
import type { PurchaseOrder, ReplenishmentRow } from "./types";

interface Edit { supplierId?: number | null; qty?: string; cost?: string }
interface CreateResult { supplierId: number; supplier: string; po?: PurchaseOrder; error?: string }

export function Replenishment() {
  return <RequireCapability any={["purchasing.read"]}><ReplenishmentInner /></RequireCapability>;
}

function ReplenishmentInner() {
  const [branchId, setBranchId] = useWorkingBranch();
  return (
    <AdminPage title="Replenishment" description="Products that have fallen to or below their low-stock threshold at one store, with how fast they sell and who can supply them. Pick the ones to reorder and create draft purchase orders."
      actions={<StoreSelect id="rep-store" value={branchId} onChange={setBranchId} />}>
      <HowItWorks />
      {branchId ? <Suggestions key={branchId} branchId={branchId} /> : <EmptyState title="Choose a store">Replenishment is calculated one store at a time.</EmptyState>}
    </AdminPage>
  );
}

/** Restates the service's own rules (`replenishment_suggestions` in backend/apps/purchasing/services.py). */
function HowItWorks() {
  return (
    <details className="rounded-lg border border-line bg-white p-4 text-sm shadow-sm">
      <summary className="cursor-pointer font-semibold text-ink">How suggestions are worked out</summary>
      <div className="mt-3 space-y-2 text-ink-2">
        <p>The list shows products at or below their low-stock threshold, with measured sales velocity. Nothing is estimated from thin air.</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Included when</strong> the product is active, has a low-stock threshold above zero, and its available stock (on hand minus reserved) is at or below that threshold. Products without a threshold are never suggested; set thresholds on the Stock page.</li>
          <li><strong>Sales per day</strong> is the units sold (picked orders) at this store in the last 30 days divided by 30. It shows a dash if nothing sold.</li>
          <li><strong>Days of cover</strong> is available stock divided by sales per day, shown only when there are sales.</li>
          <li><strong>Suggested quantity</strong> is the larger of the product’s reorder quantity and (2 × the threshold − available stock). It does <em>not</em> subtract what is already on order, so check the On order column before ordering.</li>
          <li><strong>Suppliers</strong> are the active suppliers whose catalogue lists the product. The default is the one with the lowest listed unit cost (shorter lead time breaks ties, then name); you can change it on each row. The API has no “preferred supplier” setting.</li>
        </ul>
      </div>
    </details>
  );
}

function Suggestions({ branchId }: { branchId: number }) {
  const { can, branches } = useAdmin();
  const money = useMoney();
  const q = useAdminGet<ReplenishmentRow[]>("/purchasing/replenishment/", { branch: branchId });
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [edits, setEdits] = React.useState<Record<number, Edit>>({});
  const [confirming, setConfirming] = React.useState(false);
  const [results, setResults] = React.useState<CreateResult[] | null>(null);
  const canWrite = can("purchasing.write");
  const storeName = branches.find((b) => b.id === branchId)?.name ?? "this store";

  const plan = React.useMemo<PlanRow[]>(() => (q.data ?? []).map((r) => {
    const e = edits[r.product_id] ?? {};
    const supplierId = e.supplierId !== undefined ? e.supplierId : (defaultSupplier(r.suppliers)?.id ?? null);
    const supplier = r.suppliers.find((s) => s.id === supplierId);
    return {
      productId: r.product_id, name: r.name, sku: r.sku, supplierId,
      qty: e.qty ?? trimDec(r.suggested_qty),
      unitCost: e.cost ?? (supplier?.unit_cost ? costInputText(supplier.unit_cost) : ""),
      selected: selected.has(r.product_id),
    };
  }), [q.data, edits, selected]);

  const { groups, problems } = React.useMemo(() => groupBySupplier(plan), [plan]);
  const supplierName = (id: number) => q.data?.flatMap((r) => r.suppliers).find((s) => s.id === id)?.name ?? `Supplier ${id}`;
  const selectable = (q.data ?? []).filter((r) => r.suppliers.length > 0);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.product_id));
  const patch = (id: number, p: Edit) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...p } }));
  const toggle = (id: number, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const create = useFormAction(async (gs: typeof groups) => {
    const out: CreateResult[] = [];
    for (const g of gs) { // one draft PO per supplier, created one after another so a failure is reported against its own supplier
      try {
        const po = await adminRequest<PurchaseOrder>("POST", "/purchase-orders/", { supplier_id: g.supplierId, branch_id: branchId, notes: "Created from replenishment suggestions.", lines: g.lines });
        out.push({ supplierId: g.supplierId, supplier: supplierName(g.supplierId), po });
      } catch (e) {
        out.push({ supplierId: g.supplierId, supplier: supplierName(g.supplierId), error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." });
      }
    }
    return out;
  }, {
    invalidate: ["/purchase-orders", "/purchasing"],
    success: (r) => { const ok = r.filter((x) => x.po).length; return ok ? `${ok} draft purchase ${ok === 1 ? "order" : "orders"} created.` : undefined; },
    onSuccess: (r, gs) => {
      setResults(r);
      setConfirming(false);
      const done = new Set(r.filter((x) => x.po).flatMap((x) => gs.find((g) => g.supplierId === x.supplierId)?.lines.map((l) => l.product_id) ?? []));
      setSelected((s) => new Set([...s].filter((id) => !done.has(id))));
    },
  });

  if (q.error) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load suggestions" /></Card>;
  if (!q.data) return <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!q.data.length) {
    return <Card><EmptyState icon={<PackageSearch className="size-7" aria-hidden />} title="Nothing to reorder">No active product at {storeName} is at or below its low-stock threshold. Products without a threshold are never suggested; set thresholds on the <Link className="underline" href="/admin/inventory">Stock page</Link>.</EmptyState></Card>;
  }

  const selectedCount = plan.filter((p) => p.selected).length;
  const input = "h-9 text-sm";
  return (
    <div className="space-y-4">
      {results && (
        <Alert tone={results.every((r) => r.po) ? "ok" : results.some((r) => r.po) ? "warn" : "bad"} title="Draft purchase orders">
          <ul className="mt-1 space-y-1">
            {results.map((r) => (
              <li key={r.supplierId}>{r.po
                ? <><strong>{r.supplier}</strong>: <Link className="underline" href={`/admin/purchase-orders/${r.po.id}`}>{r.po.number}</Link> created as a draft with {r.po.line_count} {r.po.line_count === 1 ? "line" : "lines"}.</>
                : <><strong>{r.supplier}</strong>: not created. {r.error}</>}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">Drafts can be reviewed, edited and submitted from the order page.</p>
        </Alert>
      )}
      {canWrite && <Checkbox className="md:hidden" label="Select every product that has a supplier" checked={allSelected} disabled={!selectable.length}
        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.product_id)) : new Set())} />}
      <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm">
        <table className="w-full text-left text-sm md:min-w-[52rem] max-md:block">
          <caption className="sr-only">Replenishment suggestions for {storeName}</caption>
          <thead className="border-b border-line bg-paper-2/60 text-xs uppercase tracking-wide text-ink-3 max-md:hidden">
            <tr>
              <th scope="col" className="w-10 px-4 py-3">
                {canWrite && <input type="checkbox" className="size-4 accent-[var(--color-primary)]" aria-label="Select every product that has a supplier" checked={allSelected} disabled={!selectable.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.product_id)) : new Set())} />}
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">Product</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Available</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">On order</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Sales, last 30 days</th>
              <th scope="col" className="px-4 py-3 font-semibold">Order quantity</th>
              <th scope="col" className="px-4 py-3 font-semibold">Supplier</th>
              <th scope="col" className="px-4 py-3 font-semibold">Unit cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line max-md:block">
            {q.data.map((r, i) => {
              const p = plan[i];
              const showProb = problems.get(r.product_id); // only selected rows are checked
              const noSupplier = r.suppliers.length === 0;
              const out = Number(r.available) <= 0;
              return (
                <tr key={r.product_id} className="align-top max-md:grid max-md:grid-cols-2 max-md:gap-x-3 max-md:gap-y-3 max-md:p-4">
                  <td className="px-4 py-3 max-md:col-span-2 max-md:p-0">
                    {canWrite && <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" aria-label={`Select ${r.name}`} checked={p.selected} disabled={noSupplier} onChange={(e) => toggle(r.product_id, e.target.checked)} />}
                  </td>
                  <td className="px-4 py-3 max-md:col-span-2 max-md:p-0">
                    <div className="min-w-40"><p className="font-semibold text-ink">{r.name}</p>
                    <p className="text-xs text-ink-3">{r.sku}</p>
                    {noSupplier && <p className="mt-1 max-w-52 text-xs text-warn">No active supplier lists this product. Add it to a supplier’s catalogue first.</p>}
                    </div>
                  </td>
                  <td data-label="Available" className="num px-4 py-3 text-right max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[0.7rem] max-md:before:font-semibold max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-ink-3 max-md:before:content-[attr(data-label)]">
                    <span className={`whitespace-nowrap font-semibold ${out ? "text-bad" : "text-warn"}`}>{formatQty(r.available, r.unit)}</span>
                    {out && <span className="block text-xs font-semibold text-bad">Out of stock</span>}
                    <span className="block whitespace-nowrap text-xs font-normal text-ink-3">low at {formatQty(r.threshold, r.unit)}</span>
                  </td>
                  <td data-label="On order" className="num whitespace-nowrap px-4 py-3 text-right max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[0.7rem] max-md:before:font-semibold max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-ink-3 max-md:before:content-[attr(data-label)]">{Number(r.on_order) > 0 ? formatQty(r.on_order, r.unit) : "—"}</td>
                  <td data-label="Sales, last 30 days" className="num px-4 py-3 text-right max-md:col-span-2 max-md:p-0 max-md:text-left max-md:before:mb-0.5 max-md:before:block max-md:before:text-[0.7rem] max-md:before:font-semibold max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-ink-3 max-md:before:content-[attr(data-label)]">
                    <span className="whitespace-nowrap">{r.avg_daily_sales ? `${formatQty(r.avg_daily_sales)} / day` : "No sales"}</span>
                    <span className="block whitespace-nowrap text-xs text-ink-3">{r.days_of_cover ? `${r.days_of_cover} days of cover` : "cover unknown"}</span>
                  </td>
                  <td data-label="Order quantity" className="px-4 py-3 max-md:p-0 max-md:before:mb-0.5 max-md:before:block max-md:before:text-[0.7rem] max-md:before:font-semibold max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-ink-3 max-md:before:content-[attr(data-label)]">
                    <Input aria-label={`Order quantity for ${r.name}`} inputMode="decimal" className={`${input} w-24`} value={p.qty} disabled={noSupplier} onChange={(e) => patch(r.product_id, { qty: e.target.value })} aria-invalid={showProb?.qty ? true : undefined} />
                    <p className="mt-1 text-xs text-ink-3">suggested {formatQty(r.suggested_qty, r.unit)}</p>
                    {showProb?.qty && <p role="alert" className="mt-1 max-w-36 text-xs font-medium text-bad">{showProb.qty}</p>}
                  </td>
                  <td data-label="Supplier" className="px-4 py-3 max-md:col-span-2 max-md:p-0 max-md:before:mb-0.5 max-md:before:block max-md:before:text-[0.7rem] max-md:before:font-semibold max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-ink-3 max-md:before:content-[attr(data-label)]">
                    {noSupplier ? <span className="text-ink-3">—</span> : (
                      <Select aria-label={`Supplier for ${r.name}`} className={`${input} w-48 max-md:w-full`} value={p.supplierId ?? ""}
                        onChange={(e) => patch(r.product_id, { supplierId: e.target.value ? Number(e.target.value) : null, cost: undefined })}>
                        {r.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.unit_cost ? money(s.unit_cost) : "no cost"} · {s.lead_time_days}d</option>)}
                      </Select>
                    )}
                  </td>
                  <td data-label="Unit cost" className="px-4 py-3 max-md:p-0 max-md:before:mb-0.5 max-md:before:block max-md:before:text-[0.7rem] max-md:before:font-semibold max-md:before:uppercase max-md:before:tracking-wide max-md:before:text-ink-3 max-md:before:content-[attr(data-label)]">
                    {noSupplier ? <span className="text-ink-3">—</span> : (
                      <>
                        <Input aria-label={`Unit cost for ${r.name}`} inputMode="decimal" className={`${input} w-24`} value={p.unitCost} placeholder="Enter cost" onChange={(e) => patch(r.product_id, { cost: e.target.value })} aria-invalid={showProb?.cost ? true : undefined} />
                        {showProb?.cost && <p role="alert" className="mt-1 max-w-36 text-xs font-medium text-bad">{showProb.cost}</p>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4 shadow-sm">
        <p role="status" className="text-sm text-ink-2">
          {canWrite ? (selectedCount ? <><strong>{selectedCount}</strong> {selectedCount === 1 ? "product" : "products"} selected, grouped into <strong>{groups.length}</strong> draft {groups.length === 1 ? "order" : "orders"} (one per supplier).{problems.size > 0 && <span className="font-semibold text-bad"> Fix the {problems.size} marked {problems.size === 1 ? "row" : "rows"} to continue.</span>}</> : "Select the products to reorder.") : "You can see suggestions but not create purchase orders."}
        </p>
        {canWrite && <Button disabled={!selectedCount || problems.size > 0} onClick={() => { setResults(null); create.clear(); setConfirming(true); }}>Create draft PO{groups.length > 1 ? "s" : ""}</Button>}
      </div>

      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={`Create ${groups.length} draft purchase ${groups.length === 1 ? "order" : "orders"}?`} confirmLabel="Create drafts" loading={create.mutation.isPending}
        description={`Drafts are delivered to ${storeName}. Nothing is sent to suppliers; you can edit and submit each draft afterwards.`}
        onConfirm={() => create.mutation.mutate(groups)}>
        <ul className="mt-2 divide-y divide-line text-sm">
          {groups.map((g) => (
            <li key={g.supplierId} className="py-2.5">
              <p className="flex justify-between gap-3"><strong>{supplierName(g.supplierId)}</strong><span className="num font-semibold">{money(g.total)}</span></p>
              <p className="text-ink-2">{g.lines.length} {g.lines.length === 1 ? "line" : "lines"}: {g.productNames.join(", ")}</p>
            </li>
          ))}
        </ul>
        {create.message && <p role="alert" className="mt-2 text-sm font-medium text-bad">{create.message}</p>}
      </ConfirmDialog>
    </div>
  );
}


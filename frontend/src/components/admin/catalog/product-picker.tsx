"use client";

import { useQueries } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import * as React from "react";
import { useDebouncedValue } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { apiGet } from "@/lib/api";
import { useAdminList } from "@/lib/admin";
import { ReorderButtons, moveItem } from "./form-kit";

export interface ProductRef { id: number; sku: string; name: string; status?: string }

const RESOLVE_CAP = 60;
const NONE: ProductRef[] = [];

/**
 * Names for a set of product ids. The promotion / coupon / article APIs return ids only, so unknown ids are looked up
 * one by one (cached); beyond RESOLVE_CAP ids the rest are shown by number rather than firing hundreds of requests.
 */
export function useProductRefs(ids: number[], known: ProductRef[] = NONE): Map<number, ProductRef | null> {
  const knownMap = React.useMemo(() => new Map(known.map((k) => [k.id, k])), [known]);
  const missing = React.useMemo(() => ids.filter((id) => !knownMap.has(id)).slice(0, RESOLVE_CAP), [ids, knownMap]);
  const results = useQueries({
    queries: missing.map((id) => ({
      queryKey: ["admin", `/products/${id}/`, {}],
      queryFn: ({ signal }: { signal: AbortSignal }) => apiGet<ProductRef>(`/admin/products/${id}/`, undefined, signal),
      staleTime: 5 * 60_000,
    })),
  });
  return React.useMemo(() => {
    const out = new Map<number, ProductRef | null>(knownMap);
    missing.forEach((id, i) => {
      const d = results[i]?.data;
      if (d) out.set(id, { id: d.id, sku: d.sku, name: d.name, status: d.status });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownMap, missing, results.map((r) => r.dataUpdatedAt).join(",")]);
}

/** Search box + results with an explicit "Add" button per row (keyboard friendly, no drag and drop). */
export function ProductPicker({ selectedIds, onAdd, label = "Find a product to add", disabled }: { selectedIds: number[]; onAdd: (p: ProductRef) => void; label?: string; disabled?: boolean }) {
  const id = React.useId();
  const [q, setQ] = React.useState("");
  const term = useDebouncedValue(q.trim(), 300);
  const { rows, isLoading, error, count } = useAdminList<ProductRef>("/products/", { search: term, page_size: 8, ordering: "name", status: "ACTIVE,INACTIVE" }, { enabled: term.length >= 2 });
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-semibold text-ink">{label}</label>
      <Input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name, SKU or barcode…" disabled={disabled} autoComplete="off" aria-describedby={`${id}-status`} />
      <p id={`${id}-status`} className="text-xs text-ink-3" role="status">
        {term.length < 2 ? "Type at least two characters to search." : isLoading ? "Searching…" : error ? "Search failed. Try again." : count === 0 ? "No products match." : `${count} ${count === 1 ? "match" : "matches"}${count > rows.length ? `, showing the first ${rows.length}` : ""}.`}
      </p>
      {term.length >= 2 && rows.length > 0 && (
        <ul className="divide-y divide-line rounded-md border border-line bg-white" aria-label="Search results">
          {rows.map((p) => {
            const added = selectedIds.includes(p.id);
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0"><span className="block truncate font-medium text-ink">{p.name}</span><span className="num text-xs text-ink-3">{p.sku}{p.status && p.status !== "ACTIVE" ? ` · ${p.status.toLowerCase()}` : ""}</span></span>
                <Button variant="secondary" size="sm" disabled={added || disabled} onClick={() => onAdd(p)} aria-label={added ? `${p.name} is already added` : `Add ${p.name}`}>
                  {added ? "Added" : <><Plus className="size-4" aria-hidden /> Add</>}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A set of products (picker + chosen list). `ordered` adds up/down buttons and numbers the rows. */
export function ProductSetField({ ids, onChange, known = NONE, ordered, label, emptyText = "None chosen yet.", disabled, error }: {
  ids: number[]; onChange: (ids: number[]) => void; known?: ProductRef[]; ordered?: boolean; label: string; emptyText?: string; disabled?: boolean; error?: string;
}) {
  const [added, setAdded] = React.useState<ProductRef[]>(NONE);
  const knownAll = React.useMemo(() => (added.length ? [...known, ...added] : known), [known, added]);
  const refs = useProductRefs(ids, knownAll);
  const add = (p: ProductRef) => {
    setAdded((a) => [...a, p]);
    onChange([...ids, p.id]);
  };
  return (
    <div className="space-y-3">
      <ProductPicker selectedIds={ids} onAdd={add} label={label} disabled={disabled} />
      {error && <p role="alert" className="text-sm font-medium text-bad">{error}</p>}
      <div>
        <p className="mb-1 text-sm font-semibold text-ink">Chosen products <span className="num font-normal text-ink-3">({ids.length})</span></p>
        {ids.length === 0 ? <p className="text-sm text-ink-3">{emptyText}</p> : (
          <ul className="divide-y divide-line rounded-md border border-line bg-white" aria-label="Chosen products">
            {ids.map((pid, i) => {
              const ref = refs.get(pid) ?? null;
              const name = ref?.name ?? `Product #${pid}`;
              return (
                <li key={pid} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{ordered && <span className="num mr-2 text-ink-3">{i + 1}.</span>}{name}</span>
                    <span className="num text-xs text-ink-3">{ref ? ref.sku : "name not loaded"}{ref?.status && ref.status !== "ACTIVE" && <Badge className="ml-2" tone="neutral">{ref.status.toLowerCase()}</Badge>}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {ordered && <ReorderButtons index={i} count={ids.length} label={name} disabled={disabled} onMove={(d) => onChange(moveItem(ids, i, d))} />}
                    <Button variant="ghost" size="icon-sm" disabled={disabled} onClick={() => onChange(ids.filter((x) => x !== pid))} aria-label={`Remove ${name}`}><X className="size-4" aria-hidden /></Button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { useMoney, useStore } from "@/lib/hooks";
import type { BrandRow, CategoryRow } from "../catalog/product-model";
import { PromotionEditor } from "./promotion-editor";
import { PROMO_KINDS, describeTargets, promotionState, summarisePromotion, type PromoState, type PromotionRow } from "./promotion-model";

const TONE: Record<PromoState, "ok" | "info" | "neutral" | "warn"> = { Running: "ok", Scheduled: "info", Ended: "neutral", Off: "warn" };

export function PromotionsTab() {
  const { can } = useAdmin();
  const canWrite = can("promotions.manage");
  const store = useStore();
  const money = useMoney();
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [kind, setKind] = React.useState("");
  const [state, setState] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [q, kind, state]);
  const list = useAdminList<PromotionRow>("/promotions/", { search: q.trim() || undefined, kind: kind || undefined, running: state === "running" ? true : undefined, is_active: state === "off" ? "false" : state === "on" ? "true" : undefined, page, page_size: 20 });
  const categories = useAdminList<CategoryRow>("/categories/");
  const brands = useAdminList<BrandRow>("/brands/");
  const [editing, setEditing] = React.useState<{ promotion?: PromotionRow } | null>(null);
  const ctx = { money, timeZone: store.timezone, locale: store.locale };

  const targets = (p: PromotionRow) => {
    if (p.scope === "PRODUCTS") return describeTargets("PRODUCTS", [], p.products.length);
    if (p.scope === "CATEGORIES") return describeTargets("CATEGORIES", p.categories.map((id) => categories.rows.find((c) => c.id === id)?.name).filter((n): n is string => !!n), p.categories.length);
    return describeTargets("BRANDS", p.brands.map((id) => brands.rows.find((b) => b.id === id)?.name).filter((n): n is string => !!n), p.brands.length);
  };
  const columns: Column<PromotionRow>[] = [
    { key: "name", header: "Promotion", cell: (p) => <><button type="button" className="text-left font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setEditing({ promotion: p })}>{p.name}</button><p className="mt-0.5"><Badge tone="accent">{p.label}</Badge>{p.is_demo && <Badge className="ml-2" tone="neutral">Demo</Badge>}</p></> },
    { key: "offer", header: "Offer", cell: (p) => <span className="text-ink-2">{summarisePromotion({ kind: p.kind, scope: p.scope, percent: p.percent ?? "", amountOff: p.amount_off ?? "", multibuyQty: p.multibuy_qty == null ? "" : String(p.multibuy_qty), multibuyPrice: p.multibuy_price ?? "", startsAt: p.starts_at, endsAt: p.ends_at }, targets(p), ctx)}</span> },
    { key: "state", header: "State", cell: (p) => { const s = promotionState(p); return <Badge tone={TONE[s]}>{s}</Badge>; } },
  ];
  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search name or badge text…" label="Search promotions" />
        <FilterSelect label="Type" value={kind} onChange={setKind} options={PROMO_KINDS.map((k) => [k.value, k.title])} />
        <FilterSelect label="State" value={state} onChange={setState} options={[["running", "Running now"], ["on", "Switched on"], ["off", "Switched off"]]} />
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New promotion</Button>}
      </FilterBar>
      <DataTable<PromotionRow> caption="Promotions" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState title={q || kind || state ? "No promotions match" : "No promotions yet"} action={canWrite && !(q || kind || state) ? <Button onClick={() => setEditing({})}>Create the first promotion</Button> : undefined}>{q || kind || state ? "Try a different search or filter." : "Promotions change prices automatically between their start and end dates."}</EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="promotions" />
      {editing && <PromotionEditor key={editing.promotion?.id ?? "new"} promotion={editing.promotion} categories={categories.rows} brands={brands.rows} canWrite={canWrite} onClose={() => setEditing(null)} />}
    </div>
  );
}

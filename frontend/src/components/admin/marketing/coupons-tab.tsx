"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { DataTable, FilterBar, FilterSelect, Pager, SearchField, useDebouncedValue, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useAdmin, useAdminList } from "@/lib/admin";
import { formatDate } from "@/lib/format";
import { useMoney } from "@/lib/hooks";
import type { CategoryRow } from "../catalog/product-model";
import { CouponEditor } from "./coupon-editor";
import { COUPON_KINDS, couponState, type CouponRow, type CouponState } from "./coupon-model";

const TONE: Record<CouponState, "ok" | "info" | "neutral" | "warn" | "bad"> = { Live: "ok", Scheduled: "info", Expired: "neutral", "Used up": "warn", Off: "warn" };
const day = (iso: string) => formatDate(iso, "en-US", { day: "numeric", month: "short", year: "numeric" });

export function CouponsTab() {
  const { can } = useAdmin();
  const canWrite = can("promotions.manage");
  const money = useMoney();
  const [search, setSearch] = React.useState("");
  const q = useDebouncedValue(search);
  const [kind, setKind] = React.useState("");
  const [active, setActive] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [q, kind, active]);
  const list = useAdminList<CouponRow>("/coupons/", { search: q.trim() || undefined, kind: kind || undefined, is_active: active || undefined, page, page_size: 20 });
  const categories = useAdminList<CategoryRow>("/categories/");
  const [editing, setEditing] = React.useState<{ coupon?: CouponRow } | null>(null);

  const offer = (c: CouponRow) => (c.kind === "FREE_DELIVERY" ? "Free delivery" : c.kind === "PERCENT" ? `${Number(c.value)}% off${c.max_discount ? ` (up to ${money(c.max_discount)})` : ""}` : `${money(c.value)} off`);
  const columns: Column<CouponRow>[] = [
    { key: "code", header: "Code", cell: (c) => <><button type="button" className="num text-left font-semibold text-primary underline-offset-4 hover:underline" onClick={() => setEditing({ coupon: c })}>{c.code}</button>{c.description && <p className="max-w-56 truncate text-xs text-ink-3">{c.description}</p>}</> },
    { key: "offer", header: "Offer", cell: (c) => <>{offer(c)}{Number(c.min_order_value) > 0 && <span className="block text-xs text-ink-3">Min spend {money(c.min_order_value)}</span>}{c.first_order_only && <span className="block text-xs text-ink-3">First order only</span>}</> },
    { key: "usage", header: "Used", align: "right", cell: (c) => <span>{c.used_count}{c.usage_limit != null ? <span className="text-ink-3"> / {c.usage_limit}</span> : <span className="text-ink-3"> (no limit)</span>}</span> },
    { key: "window", header: "Valid", hideBelow: "md", cell: (c) => <span className="whitespace-nowrap text-ink-2">{day(c.starts_at)} → {c.ends_at ? day(c.ends_at) : "no expiry"}</span> },
    { key: "state", header: "State", cell: (c) => { const s = couponState(c); return <Badge tone={TONE[s]}>{s}</Badge>; } },
  ];
  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField value={search} onChange={setSearch} placeholder="Search code or description…" label="Search coupons" />
        <FilterSelect label="Type" value={kind} onChange={setKind} options={COUPON_KINDS.map((k) => [k.value, k.title])} />
        <FilterSelect label="Switch" value={active} onChange={setActive} options={[["true", "On"], ["false", "Off"]]} />
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => setEditing({})}><Plus className="size-4" aria-hidden /> New coupon</Button>}
      </FilterBar>
      <DataTable<CouponRow> caption="Coupons" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
        empty={<EmptyState title={q || kind || active ? "No coupons match" : "No coupons yet"} action={canWrite && !(q || kind || active) ? <Button onClick={() => setEditing({})}>Create the first coupon</Button> : undefined}>{q || kind || active ? "Try a different search or filter." : "Coupons are codes customers type at checkout."}</EmptyState>} />
      <Pager page={list.page} totalPages={list.totalPages} count={list.count} onPage={setPage} label="coupons" />
      {editing && <CouponEditor key={editing.coupon?.id ?? "new"} coupon={editing.coupon} categories={categories.rows} canWrite={canWrite} onClose={() => setEditing(null)} />}
    </div>
  );
}

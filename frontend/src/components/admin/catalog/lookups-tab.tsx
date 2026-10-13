"use client";

import { DataTable, type Column } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { useAdminList } from "@/lib/admin";
import type { AllergenLookup, UnitRow } from "./product-model";

const KIND: Record<string, string> = { COUNT: "Counted", WEIGHT: "Weight", VOLUME: "Volume" };

export function UnitsTab() {
  const list = useAdminList<UnitRow>("/units/");
  const columns: Column<UnitRow>[] = [
    { key: "name", header: "Unit", cell: (u) => <span className="font-semibold text-ink">{u.name}</span> },
    { key: "symbol", header: "Symbol", cell: (u) => <span className="num">{u.symbol}</span> },
    { key: "code", header: "Code", hideBelow: "sm", cell: (u) => <span className="num text-ink-3">{u.code}</span> },
    { key: "kind", header: "Measures", cell: (u) => KIND[u.kind] ?? u.kind },
    { key: "fraction", header: "Fractions", cell: (u) => (u.allows_fraction ? <Badge tone="ok">Allowed (e.g. 0.5)</Badge> : <Badge tone="neutral">Whole numbers only</Badge>) },
  ];
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Units are reference data">Sale units are fixed by the platform so that quantities, unit prices and stock stay consistent. Products choose from this list; it can&apos;t be edited here.</Alert>
      <DataTable<UnitRow> caption="Sale units" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} />
    </div>
  );
}

export function AllergensTab() {
  const list = useAdminList<AllergenLookup>("/allergens/");
  const columns: Column<AllergenLookup>[] = [
    { key: "name", header: "Allergen", cell: (a) => <span className="font-semibold text-ink">{a.name}</span> },
    { key: "code", header: "Code", cell: (a) => <span className="num text-ink-3">{a.code}</span> },
  ];
  return (
    <div className="space-y-4">
      <Alert tone="info" title="The allergen list is reference data">It follows the 14 major allergens. You declare which allergens each product contains or may contain on the product&apos;s own page, under Allergens.</Alert>
      <DataTable<AllergenLookup> caption="Allergens" columns={columns} rows={list.rows} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()} />
    </div>
  );
}

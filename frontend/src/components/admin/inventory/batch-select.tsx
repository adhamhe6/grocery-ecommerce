"use client";

import * as React from "react";
import { Field, Select, describedBy } from "@/components/ui/field";
import { useAdminList } from "@/lib/admin";
import { formatDate, formatQty } from "@/lib/format";
import { daysLabel } from "./expiry";
import type { BatchRow } from "./types";

/** Batches of one product at one store that still have stock, soonest expiry first (GET /admin/inventory/batches/). */
export function useProductBatches(productId: number | null | undefined, branchId: number | null | undefined, enabled = true) {
  const list = useAdminList<BatchRow>("/inventory/batches/", { product: productId ?? undefined, branch: branchId ?? undefined, on_hand: "true", page_size: 100 }, { enabled: enabled && !!productId && !!branchId });
  return { batches: list.rows, isLoading: list.isLoading, error: list.error, refetch: list.refetch };
}

export function BatchSelect({ id, batches, loading, value, onChange, error, hint = "Stock is counted per batch for this product." }: {
  id: string; batches: BatchRow[]; loading?: boolean; value: number | null; onChange: (id: number | null) => void; error?: string; hint?: React.ReactNode;
}) {
  return (
    <Field label="Batch" htmlFor={id} required error={error} hint={batches.length || loading ? hint : "No batch has stock left at this store."}>
      <Select id={id} value={value ?? ""} disabled={loading || !batches.length} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, true, !!error)}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">{loading ? "Loading batches…" : "Choose a batch"}</option>
        {batches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.lot_code} · {b.expiry_date ? `${formatDate(b.expiry_date, "en-US", { day: "numeric", month: "short", year: "numeric" })} (${daysLabel(b.days_to_expiry).toLowerCase()})` : "no expiry"} · {formatQty(b.qty_remaining, b.unit)} left{b.status !== "ACTIVE" ? ` · ${b.status.toLowerCase()}` : ""}
          </option>
        ))}
      </Select>
    </Field>
  );
}

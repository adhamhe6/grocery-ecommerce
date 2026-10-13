"use client";

import { FlaskConical } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { providerLabel, type PaymentRow } from "./types";

/** Loud on purpose: nobody should mistake a sandbox payment for takings. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge tone="citrus" className={`gap-1 font-bold uppercase tracking-wide ${className ?? ""}`}>
      <FlaskConical className="size-3" aria-hidden />Demo<span className="sr-only"> payment: simulated, no money moves</span>
    </Badge>
  );
}

export function OrderLink({ number }: { number: string }) {
  return (
    <Link href={`/admin/orders/${encodeURIComponent(number)}`} onClick={(e) => e.stopPropagation()} className="num whitespace-nowrap font-semibold text-primary underline-offset-4 hover:underline">
      {number}
    </Link>
  );
}

export function ProviderCell({ p }: { p: Pick<PaymentRow, "provider" | "method" | "is_demo"> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{providerLabel(p.provider)}</span>
      {p.is_demo && <DemoBadge />}
      <span className="text-xs text-ink-3">{p.method}</span>
    </div>
  );
}

const STATE_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = {
  CAPTURED: "ok", AUTHORIZED: "info", REQUIRES_ACTION: "warn", PENDING_COLLECTION: "warn", FAILED: "bad", CANCELLED: "neutral", VOIDED: "neutral", PARTIALLY_REFUNDED: "warn", REFUNDED: "neutral",
};
export function PaymentStateBadge({ state, label }: { state: string; label: string }) {
  return <Badge tone={STATE_TONE[state] ?? "neutral"}>{label}</Badge>;
}

const OUTCOME_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = { APPLIED: "ok", ERROR: "bad", IGNORED: "neutral", DUPLICATE: "neutral" };
export function OutcomeBadge({ outcome }: { outcome: string }) {
  const label = outcome === "DUPLICATE" ? "Duplicate (ignored)" : outcome.charAt(0) + outcome.slice(1).toLowerCase();
  return <Badge tone={OUTCOME_TONE[outcome] ?? "neutral"}>{label}</Badge>;
}

const REFUND_TONE: Record<string, "ok" | "warn" | "bad" | "neutral"> = { SUCCEEDED: "ok", PENDING: "warn", FAILED: "bad" };
export function RefundStatusBadge({ status }: { status: string }) {
  return <Badge tone={REFUND_TONE[status] ?? "neutral"}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;
}

/** Labelled native date input for filter bars. */
export function DateFilter({ label, value, onChange, min, max }: { label: string; value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-semibold text-ink-2">{label}</span>
      <Input type="date" className="h-10 w-auto min-w-36 text-sm" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`break-all font-mono text-xs ${className ?? ""}`}>{children}</span>;
}

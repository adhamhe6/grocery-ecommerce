"use client";

// Building blocks shared by every staff dashboard page. Keep them dependency-light and accessible.
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/cn";

// ------------------------------------------------------------------------------------------------ page chrome
export function AdminPage({ title, description, actions, children }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[88rem]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-6">{children}</div>
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cn("rounded-lg border border-line bg-white shadow-sm", className)} aria-label={title}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          {title && <h2 className="font-sans text-base font-bold text-ink">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? "p-4 sm:p-5" : ""}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, delta, tone = "neutral" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; delta?: number | null; tone?: "neutral" | "warn" | "bad" | "ok" }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</p>
      <p className={cn("num mt-1.5 text-2xl font-semibold", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink")}>{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
        {delta != null && (
          <span className={cn("inline-flex items-center gap-0.5 font-semibold", delta >= 0 ? "text-ok" : "text-bad")}>
            {delta >= 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
            <span className="sr-only">{delta >= 0 ? "Up" : "Down"} </span>{Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {hint && <span>{hint}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ status badges
const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral" | "citrus"> = {
  COMPLETED: "ok", CONFIRMED: "info", PICKING: "citrus", PACKING: "citrus", READY_FOR_PICKUP: "info", READY_FOR_DISPATCH: "info", OUT_FOR_DELIVERY: "info", PENDING_PAYMENT: "warn", CANCELLED: "bad", PAYMENT_FAILED: "bad",
  PAID: "ok", AUTHORIZED: "info", PENDING_COLLECTION: "warn", UNPAID: "neutral", PARTIALLY_REFUNDED: "warn", REFUNDED: "bad", FAILED: "bad", VOIDED: "neutral",
  ACTIVE: "ok", DRAFT: "neutral", ARCHIVED: "neutral", EXPIRED: "bad", QUARANTINED: "warn", DEPLETED: "neutral", OPEN: "warn", IN_REVIEW: "info", RESOLVED: "ok", SENT: "info", RECEIVED: "ok", PARTIALLY_RECEIVED: "warn", CLOSED: "neutral", PENDING: "warn", APPROVED: "ok", REJECTED: "bad", SUCCEEDED: "ok",
};
export const humanise = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? humanise(status)}</Badge>;
}

// ------------------------------------------------------------------------------------------------ data table
export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right";
  /** API ordering field; makes the header a sort button. */
  sort?: string;
  className?: string;
  hideBelow?: "sm" | "md" | "lg";
}

const HIDE: Record<string, string> = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

export function DataTable<T extends { id?: number | string }>({
  columns, rows, loading, error, onRetry, empty, rowKey, onRowClick, ordering, onOrdering, caption, dense,
}: {
  columns: Column<T>[]; rows: T[]; loading?: boolean; error?: unknown; onRetry?: () => void; empty?: React.ReactNode; rowKey?: (r: T, i: number) => React.Key;
  onRowClick?: (r: T) => void; ordering?: string; onOrdering?: (o: string) => void; caption: string; dense?: boolean;
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} title="We couldn't load this list" />;
  const desc = ordering?.startsWith("-");
  const field = ordering?.replace(/^-/, "");
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line bg-paper-2/60 text-xs uppercase tracking-wide text-ink-3">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("whitespace-nowrap px-4 py-3 font-semibold", c.align === "right" && "text-right", c.hideBelow && HIDE[c.hideBelow], c.className)}
                aria-sort={c.sort && field === c.sort ? (desc ? "descending" : "ascending") : undefined}>
                {c.sort && onOrdering ? (
                  <button type="button" className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink" onClick={() => onOrdering(field === c.sort && !desc ? `-${c.sort}` : c.sort!)}>
                    {c.header}{field === c.sort && (desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                  </button>
                ) : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {loading && Array.from({ length: 6 }, (_, i) => <tr key={i}>{columns.map((c) => <td key={c.key} className={cn("px-4 py-3.5", c.hideBelow && HIDE[c.hideBelow])}><Skeleton className="h-4 w-full max-w-32" /></td>)}</tr>)}
          {!loading && rows.map((r, i) => (
            <tr key={rowKey ? rowKey(r, i) : (r.id ?? i)} className={cn("align-middle", onRowClick && "cursor-pointer hover:bg-paper/70")} onClick={onRowClick ? () => onRowClick(r) : undefined}>
              {columns.map((c) => <td key={c.key} className={cn(dense ? "px-4 py-2" : "px-4 py-3", c.align === "right" && "num text-right", c.hideBelow && HIDE[c.hideBelow], c.className)}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && <div className="border-t border-line">{empty ?? <EmptyState title="Nothing to show">No records match.</EmptyState>}</div>}
    </div>
  );
}

export function Pager({ page, totalPages, count, onPage, label = "results" }: { page: number; totalPages: number; count: number; onPage: (p: number) => void; label?: string }) {
  if (totalPages <= 1) return <p className="num text-sm text-ink-3">{count} {label}</p>;
  return (
    <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Pagination">
      <p className="num text-ink-3">{count} {label} · page {page} of {totalPages}</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" aria-hidden /> Previous</Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next <ChevronRight className="size-4" aria-hidden /></Button>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------------------------------------ filters
export function useDebouncedValue<T>(value: T, ms = 350): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function SearchField({ value, onChange, placeholder = "Search…", label = "Search" }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <label className="relative block min-w-52 flex-1 sm:max-w-sm">
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <Input type="search" className="h-10 pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function FilterSelect({ label, value, onChange, options, allLabel = "All" }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; allLabel?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-semibold text-ink-2">{label}</span>
      <Select className="h-10 w-auto min-w-36 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </label>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3" role="search">{children}</div>;
}

export function CsvButton({ href, label = "Export CSV" }: { href: string; label?: string }) {
  return <a href={href} download className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-white px-3 text-sm font-semibold text-primary hover:bg-paper-2"><Download className="size-4" aria-hidden /> {label}</a>;
}

// ------------------------------------------------------------------------------------------------ dialogs
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", danger, loading, onConfirm, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; children?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function KeyValue({ items, columns = 2 }: { items: [string, React.ReactNode][]; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-8 gap-y-3 text-sm", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-2 lg:grid-cols-3")}>
      {items.map(([k, v]) => <div key={k}><dt className="text-xs font-semibold uppercase tracking-wide text-ink-3">{k}</dt><dd className="mt-0.5 text-ink">{v ?? "—"}</dd></div>)}
    </dl>
  );
}

// ------------------------------------------------------------------------------------------------ charts (inline SVG, no chart dependency)
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export interface Datum { label: string; value: number }

/** Columns/line over an ordered x axis. A visually-hidden table carries the same data for screen readers. */
export function TrendChart({ data, title, format = (n) => String(n), kind = "bars", height = 200, color = "var(--color-primary)" }: { data: Datum[]; title: string; format?: (n: number) => string; kind?: "bars" | "line"; height?: number; color?: string }) {
  const W = 640, H = height, padL = 44, padB = 24, padT = 8, padR = 8;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const iw = W - padL - padR, ih = H - padB - padT;
  const x = (i: number) => padL + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const bw = Math.max(2, Math.min(28, iw / Math.max(data.length, 1) - 4));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.ceil(data.length / 8);
  const desc = `${title}. ${data.length ? `From ${data[0].label} to ${data[data.length - 1].label}; highest ${format(Math.max(...data.map((d) => d.value)))}.` : "No data."}`;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={desc}>
        <title>{title}</title>
        {ticks.map((t) => (
          <g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" /><text x={padL - 6} y={y(t) + 4} textAnchor="end" fontSize="10.5" fill="var(--color-ink-3)" className="num">{format(t)}</text></g>
        ))}
        {kind === "bars" ? data.map((d, i) => <rect key={i} x={x(i) - bw / 2} y={y(d.value)} width={bw} height={Math.max(0, ih - (y(d.value) - padT))} rx="2" fill={color}><title>{`${d.label}: ${format(d.value)}`}</title></rect>)
          : <>
              <polyline fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" points={data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ")} />
              {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r="3" fill={color}><title>{`${d.label}: ${format(d.value)}`}</title></circle>)}
            </>}
        {data.map((d, i) => (i % every === 0 ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10.5" fill="var(--color-ink-3)">{d.label}</text> : null))}
      </svg>
      <figcaption className="sr-only">Data for {title}</figcaption>
      <table className="sr-only"><caption>{title}</caption><tbody>{data.map((d) => <tr key={d.label}><th scope="row">{d.label}</th><td>{format(d.value)}</td></tr>)}</tbody></table>
    </figure>
  );
}

/** Horizontal bars for ranked categories (labels left, values right). */
export function RankedBars({ data, format = (n) => String(n), title }: { data: Datum[]; format?: (n: number) => string; title: string }) {
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  if (!data.length) return <p className="text-sm text-ink-3">No data for this period.</p>;
  return (
    <ul className="space-y-2.5" aria-label={title}>
      {data.map((d) => (
        <li key={d.label} className="text-sm">
          <div className="flex justify-between gap-3"><span className="truncate text-ink">{d.label}</span><span className="num shrink-0 font-semibold text-ink">{format(d.value)}</span></div>
          <div className="mt-1 h-2 rounded-full bg-paper-2" aria-hidden><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

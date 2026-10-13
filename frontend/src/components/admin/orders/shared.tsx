"use client";

// Small pieces shared by the orders, picking, cases and customers screens.
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, FlaskConical, Store, Truck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { StatusBadge } from "@/components/admin/kit";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/states";
import { adminRequest } from "@/lib/admin";
import { ApiError } from "@/lib/api";
import { formatSlotDay, formatSlotWindow } from "@/lib/format";
import { useStore } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import { PAYMENT_STATUS_LABELS } from "./actions";
import type { Sla } from "./sla";
import type { FulfilmentTypeValue, OrderDetail } from "./types";

// ------------------------------------------------------------------------------------------------ time
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Date/time formatting in the *store's* timezone (not the browser's), so staff and shop agree on "10:00". */
export function useZoneFormat() {
  const s = useStore();
  return React.useMemo(() => {
    const timeZone = s.timezone || undefined;
    const locale = s.locale || "en-US";
    const dt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone });
    const d = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone });
    const t = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone });
    const ymd = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
    const safe = <T,>(iso: string | null | undefined, f: (date: Date) => T, fallback: T) => {
      if (!iso) return fallback;
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? fallback : f(date);
    };
    return {
      dateTime: (iso: string | null | undefined) => safe(iso, (x) => dt.format(x), "—"),
      date: (iso: string | null | undefined) => safe(iso, (x) => d.format(x), "—"),
      time: (iso: string | null | undefined) => safe(iso, (x) => t.format(x), "—"),
      slotDay: (iso: string) => formatSlotDay(iso, timeZone ?? "UTC", locale),
      slotWindow: (a: string, b: string) => formatSlotWindow(a, b, timeZone ?? "UTC", locale),
      /** "Today", "Tomorrow", "Yesterday" or the weekday/date, judged in the store's timezone. */
      dayLabel: (iso: string, now: number) => {
        const key = ymd.format(new Date(iso));
        const today = ymd.format(new Date(now));
        const shifted = (days: number) => ymd.format(new Date(now + days * 86_400_000));
        if (key === today) return "Today";
        if (key === shifted(1)) return "Tomorrow";
        if (key === shifted(-1)) return "Yesterday";
        return formatSlotDay(iso, timeZone ?? "UTC", locale);
      },
    };
  }, [s.timezone, s.locale]);
}

// ------------------------------------------------------------------------------------------------ badges
export function OrderStatusBadge({ status, label }: { status: string; label?: string }) {
  return <StatusBadge status={status} label={label} />;
}

export function PaymentBadge({ status, short }: { status: string; short?: boolean }) {
  return <StatusBadge status={status} label={short && status === "PENDING_COLLECTION" ? "Cash due" : PAYMENT_STATUS_LABELS[status]} />;
}

/** Sandbox payments are flagged loudly everywhere they appear: no real money moved. */
export function DemoBadge() {
  return <Badge tone="citrus"><FlaskConical className="size-3" aria-hidden /> Demo payment — no real money</Badge>;
}

export function FulfilmentLabel({ type, className, iconOnly }: { type: FulfilmentTypeValue; className?: string; iconOnly?: boolean }) {
  const Icon = type === "DELIVERY" ? Truck : Store;
  const text = type === "DELIVERY" ? "Delivery" : "Pickup";
  return <span className={cn("inline-flex items-center gap-1.5", className)}><Icon className="size-4 shrink-0 text-ink-3" aria-hidden />{iconOnly ? <span className="sr-only">{text}</span> : text}</span>;
}

const SLA_STYLE = {
  ok: { cls: "bg-ok-soft text-ok", Icon: CheckCircle2, word: "On track" },
  soon: { cls: "bg-warn-soft text-warn", Icon: Clock, word: "Due soon" },
  late: { cls: "bg-bad-soft text-bad", Icon: AlertTriangle, word: "Late" },
} as const;

/** Urgency pill. Colour + icon + the words "On track / Due soon / Late", plus the time detail. */
export function SlaBadge({ sla, className }: { sla: Sla; className?: string }) {
  if (sla.level === "none") return null;
  const { cls, Icon, word } = SLA_STYLE[sla.level];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold leading-5", cls, className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{word}<span className="font-normal"> · {sla.label}</span></span>
    </span>
  );
}

/** Compact filter control: label above the control so a row of filters wraps tidily on a phone. */
export function FilterField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={cn("block min-w-0 text-xs font-semibold text-ink-2", className)}><span className="mb-1 block">{label}</span>{children}</label>;
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><ArrowLeft className="size-4" aria-hidden />{children}</Link>;
}

// ------------------------------------------------------------------------------------------------ errors
export function errorText(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong. Please try again.";
}

export function ErrorAlert({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null;
  const fields = error instanceof ApiError ? Object.values(error.fieldErrors) : [];
  return (
    <Alert tone="bad" title={title ?? errorText(error)} className="mt-3">
      {title ? <span className="block">{errorText(error)}</span> : null}
      {fields.length > 0 && <ul className="list-disc pl-5">{fields.map((m) => <li key={m}>{m}</li>)}</ul>}
      {error instanceof ApiError && error.requestId ? <span className="block text-xs text-ink-3">Reference: {error.requestId}</span> : null}
    </Alert>
  );
}

// ------------------------------------------------------------------------------------------------ async + url helpers
/** Runs one async job at a time. The ref guard blocks a second click that lands before React re-renders the disabled button. */
export function useAsyncTask() {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const lock = React.useRef(false);
  const run = React.useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  const reset = React.useCallback(() => setError(null), []);
  return { busy, error, run, reset };
}

/** Filters live in the query string so a view can be bookmarked, shared and reached from dashboard links. */
export function useUrlParams() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = React.useCallback((k: string) => sp.get(k) ?? "", [sp]);
  const set = React.useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page"); // any filter change starts again from page 1
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, router, pathname]);
  return { get, set };
}

// ------------------------------------------------------------------------------------------------ order API
export const orderPath = (number: string) => `/orders/${encodeURIComponent(number)}/`;
export const orderKey = (number: string) => ["admin", orderPath(number), {}] as const;

/** After any order mutation: put the fresh order in the cache and refresh everything else that shows orders. */
export function applyOrderResult(qc: QueryClient, number: string, data: OrderDetail) {
  qc.setQueryData(orderKey(number), data);
  const own = orderPath(number);
  qc.invalidateQueries({
    predicate: (q) => {
      const path = q.queryKey[1];
      return q.queryKey[0] === "admin" && typeof path === "string" && path !== own && (path.startsWith("/orders/") || path.startsWith("/cases/") || path.startsWith("/customers/") || path.startsWith("/dashboard"));
    },
  });
}

/**
 * POST helper for one order. Calls are queued, so two quick taps never race and an older response can't overwrite a
 * newer one in the cache. Errors are thrown to the caller (shown inline, next to what was being edited).
 */
export function useOrderApi(number: string) {
  const qc = useQueryClient();
  const tail = React.useRef<Promise<unknown>>(Promise.resolve());
  const call = React.useCallback(<T extends OrderDetail = OrderDetail>(path: string, body?: unknown): Promise<T> => {
    const job = tail.current.then(() => adminRequest<T>("POST", `${orderPath(number)}${path}`, body));
    tail.current = job.catch(() => undefined);
    return job.then((data) => {
      applyOrderResult(qc, number, data);
      return data;
    });
  }, [qc, number]);
  return call;
}

"use client";

// Formatting shared by the finance, reports, staff, settings and audit screens: dates are always shown in the
// STORE's time zone (not the browser's) so a manager in another country reads the same day boundaries the reports use.
import * as React from "react";
import { formatMoney } from "@/lib/format";
import { useStore } from "@/lib/hooks";

export interface DateOpts { seconds?: boolean; dateOnly?: boolean; /** leave the year out when it is the current year (for dense tables) */ compact?: boolean }

export function formatInZone(iso: string | null | undefined, locale: string, timeZone: string, opts: DateOpts = {}, now: Date = new Date()): string {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return "—";
  const zone = iso.length === 10 ? "UTC" : timeZone;
  const sameYear = (tz: string) => {
    try { return new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: tz }).format(date) === new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: tz }).format(now); } catch { return false; }
  };
  const year = opts.compact && sameYear(zone) ? {} : { year: "numeric" as const };
  const base: Intl.DateTimeFormatOptions = opts.dateOnly
    ? { day: "numeric", month: "short", ...year }
    : { day: "numeric", month: "short", ...year, hour: "numeric", minute: "2-digit", ...(opts.seconds ? { second: "2-digit" } : {}) };
  try {
    return new Intl.DateTimeFormat(locale, { ...base, timeZone: zone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", base).format(date); // unknown time zone or locale in the settings: still show something readable
  }
}

/** Returns a formatter that prints an ISO instant in the store's time zone. */
export function useStoreDateTime(opts: DateOpts = {}) {
  const s = useStore();
  const { seconds, dateOnly, compact } = opts;
  return React.useCallback((iso: string | null | undefined) => formatInZone(iso, s.locale, s.timezone, { seconds, dateOnly, compact }), [s.locale, s.timezone, seconds, dateOnly, compact]);
}

/** Money in the currency a record was created in (falls back to the store currency). Never does arithmetic. */
export function useMoneyIn() {
  const s = useStore();
  return React.useCallback((value: string | number | null | undefined, currency?: string) => {
    try {
      return formatMoney(value, currency || s.currency, s.locale);
    } catch {
      return value == null || value === "" ? "—" : `${value} ${currency ?? ""}`.trim();
    }
  }, [s.currency, s.locale]);
}

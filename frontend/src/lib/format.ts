// Display helpers. API values are exact decimal strings; we only ever convert to Number for *display*.

export function formatMoney(value: string | number | null | undefined, currency = "USD", locale = "en-US"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
}

export function formatQty(value: string | number | null | undefined, unit?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  const text = Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
  return unit ? `${text} ${unit}` : text;
}

export function formatDate(value: string | Date | null | undefined, locale = "en-US", opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T12:00:00` : value) : value;
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

export function formatDateTime(value: string | Date | null | undefined, locale = "en-US"): string {
  return formatDate(value, locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function formatTimeRange(start: string, end: string, locale = "en-US"): string {
  const t = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: m ? "2-digit" : undefined }).format(new Date(2000, 0, 1, h, m));
  };
  return `${t(start)} – ${t(end)}`;
}

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function pluralise(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Picks the best responsive variant ≥ the requested width. */
export function imgSrc(urls: Record<string, string> | undefined, width = 640): string {
  if (!urls) return "";
  const keys = Object.keys(urls).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  const pick = keys.find((k) => k >= width) ?? keys[keys.length - 1];
  return (pick ? urls[String(pick)] : urls.original) ?? "";
}

export function imgSrcSet(urls: Record<string, string> | undefined): string | undefined {
  if (!urls) return undefined;
  const keys = Object.keys(urls).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
  return keys.length > 1 ? keys.map((k) => `${urls[String(k)]} ${k}w`).join(", ") : undefined;
}

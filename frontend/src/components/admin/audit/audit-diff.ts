// Turns an audit entry's `before` / `after` snapshots into a field-by-field comparison.
// The server already leaves secrets (passwords, tokens) out of these snapshots; we show exactly what it sent.

export type DiffStatus = "added" | "removed" | "changed" | "unchanged";
export interface DiffRow { key: string; status: DiffStatus; before: unknown; after: unknown }
export interface AuditDiff {
  /** none: nothing recorded · created: only `after` · deleted: only `before` · changed: both. */
  mode: "none" | "created" | "deleted" | "changed";
  rows: DiffRow[];
  changedCount: number;
  unchangedCount: number;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** JSON with sorted object keys, so two equal values always compare equal regardless of key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

const asRecord = (v: unknown): Record<string, unknown> => (isPlainObject(v) ? v : { "(value)": v });

export function buildAuditDiff(before: unknown, after: unknown): AuditDiff {
  const hasBefore = before !== null && before !== undefined;
  const hasAfter = after !== null && after !== undefined;
  if (!hasBefore && !hasAfter) return { mode: "none", rows: [], changedCount: 0, unchangedCount: 0 };
  const b = hasBefore ? asRecord(before) : {};
  const a = hasAfter ? asRecord(after) : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const rows: DiffRow[] = keys.map((key) => {
    const inB = key in b, inA = key in a;
    let status: DiffStatus;
    if (!hasBefore) status = "added";
    else if (!hasAfter) status = "removed";
    else if (!inB) status = "added";
    else if (!inA) status = "removed";
    else status = stableStringify(b[key]) === stableStringify(a[key]) ? "unchanged" : "changed";
    return { key, status, before: b[key], after: a[key] };
  });
  const weight = (s: DiffStatus) => (s === "unchanged" ? 1 : 0);
  rows.sort((x, y) => weight(x.status) - weight(y.status) || x.key.localeCompare(y.key));
  const unchangedCount = rows.filter((r) => r.status === "unchanged").length;
  return { mode: !hasBefore ? "created" : !hasAfter ? "deleted" : "changed", rows, changedCount: rows.length - unchangedCount, unchangedCount };
}

/** Text for one value. Empty strings and null are spelled out so "nothing" is never mistaken for a blank cell. */
export function displayValue(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function truncate(text: string, max = 140): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max).trimEnd()}…`, truncated: true };
}

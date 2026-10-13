// Exact decimal arithmetic for money (2 dp) and quantities (3 dp).
//
// The API speaks decimal *strings*. Everything here parses to a scaled BigInt ("integer thousandths" / "integer cents"),
// computes with integers and rounds half-up (away from zero) exactly like the server's `money()` / `qty()` helpers.
// Floats are never involved, so 0.1 + 0.2 is 0.30 and 1.9 kg x 10.42 is 19.80, not 19.797999….

export const MONEY_SCALE = 2;
export const QTY_SCALE = 3;

const NUMBER_RE = /^([+-])?(\d+)?(?:\.(\d*))?$/;

/** Divide with rounding half away from zero (Decimal ROUND_HALF_UP). `d` must be positive. */
export function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (2n * a + d) / (2n * d);
  return neg ? -q : q;
}

/**
 * Parse a decimal string into an integer scaled by 10^scale. Returns null for anything that is not a plain decimal
 * number or that has more than `scale` significant decimals ("1.2345" with scale 3 is rejected, "1.2300" is fine).
 */
export function parseScaled(input: string | null | undefined, scale: number): bigint | null {
  if (input === null || input === undefined) return null;
  const s = input.trim();
  if (!s || s === "." || s === "+" || s === "-") return null;
  const m = NUMBER_RE.exec(s);
  if (!m) return null;
  const [, sign, whole = "", fraction = ""] = m;
  if (!whole && !fraction) return null;
  const extra = fraction.slice(scale);
  if (/[1-9]/.test(extra)) return null; // would lose precision
  const padded = fraction.slice(0, scale).padEnd(scale, "0");
  const value = BigInt((whole || "0") + padded);
  return sign === "-" ? -value : value;
}

export function formatScaled(value: bigint, scale: number, opts: { trim?: boolean } = {}): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  let out = scale > 0 ? `${whole}.${(abs % base).toString().padStart(scale, "0")}` : `${whole}`;
  if (opts.trim && out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return neg && value !== 0n ? `-${out}` : out;
}

/** Phones in many locales type a decimal comma; treat it as a point so “1,62” is not rejected. */
export const decimalInput = (value: string) => value.replace(/,/g, ".");

export const parseMoney = (s: string | null | undefined) => parseScaled(s, MONEY_SCALE);
export const parseQty = (s: string | null | undefined) => parseScaled(s, QTY_SCALE);
export const fmtMoney = (v: bigint) => formatScaled(v, MONEY_SCALE);
export const fmtQty = (v: bigint) => formatScaled(v, QTY_SCALE, { trim: true });

/** "1.50" -> "1.5", "2.000" -> "2"; null when it is not a valid quantity (max 3 decimals). */
export function normaliseQty(s: string | null | undefined): string | null {
  const v = parseQty(s);
  return v === null ? null : fmtQty(v);
}

/** Sum of money strings; null/empty entries count as zero, any malformed entry makes the result null. */
export function sumMoney(values: (string | null | undefined)[]): string | null {
  let total = 0n;
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    const p = parseMoney(v);
    if (p === null) return null;
    total += p;
  }
  return fmtMoney(total);
}

export function subMoney(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = parseMoney(a ?? "0");
  const y = parseMoney(b ?? "0");
  return x === null || y === null ? null : fmtMoney(x - y);
}

export function subQty(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = parseQty(a);
  const y = parseQty(b);
  return x === null || y === null ? null : fmtQty(x - y);
}

/** Compare two decimal strings of any precision up to 6 dp. null when either is malformed. */
export function compareDecimal(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const x = parseScaled(a, 6);
  const y = parseScaled(b, 6);
  if (x === null || y === null) return null;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** unit price (2 dp) x quantity (3 dp) rounded half-up to cents; null if either input is invalid. */
export function lineTotal(unitPrice: string | null | undefined, quantity: string | null | undefined): string | null {
  const price = parseMoney(unitPrice);
  const q = parseQty(quantity);
  if (price === null || q === null) return null;
  return fmtMoney(divRound(price * q, 10n ** BigInt(QTY_SCALE)));
}

/**
 * The weight window the server accepts for a weighed line: ordered x (1 -/+ tolerance%), rounded half-up to grams.
 * `percent` is the store's `weight_tolerance_percent` string (e.g. "10.00").
 */
export function toleranceWindow(ordered: string, percent: string): { min: string; max: string } | null {
  const o = parseQty(ordered);
  const p = parseScaled(percent, 2); // hundredths of a percent
  if (o === null || p === null || p < 0n) return null;
  const low = divRound(o * (10000n - p), 10000n);
  const high = divRound(o * (10000n + p), 10000n);
  return { min: fmtQty(low < 0n ? 0n : low), max: fmtQty(high) };
}

// ------------------------------------------------------------------------------------------------ picking
export interface PickCheckInput {
  /** What the picker typed. */
  raw: string;
  ordered: string;
  weighed: boolean;
  /** Accepted weight window for weighed lines (from the API's `tolerance`). */
  window?: { min: string; max: string } | null;
}

export type PickStatus =
  | "empty" //        nothing typed yet
  | "invalid" //      not a number / too many decimals / negative
  | "zero" //         0 - that is "unavailable", not a pick
  | "full" //         exactly what was asked for (or inside the weight window)
  | "short" //        less than ordered (or below the weight window)
  | "over_window" //  weighed line heavier than the window allows: needs a manager override
  | "over_ordered"; // counted line, more than the customer ordered: never allowed

export interface PickCheck {
  status: PickStatus;
  /** Canonical picked quantity ("1.9"); null unless the input parsed. */
  qty: string | null;
  /** The quantity the customer is charged for: the picked weight, capped at the window maximum. */
  chargedQty: string | null;
}

export function checkPick(input: PickCheckInput): PickCheck {
  const raw = input.raw.trim();
  if (!raw) return { status: "empty", qty: null, chargedQty: null };
  const picked = parseQty(raw);
  if (picked === null || picked < 0n) return { status: "invalid", qty: null, chargedQty: null };
  const qty = fmtQty(picked);
  if (picked === 0n) return { status: "zero", qty, chargedQty: null };
  const ordered = parseQty(input.ordered);
  if (ordered === null) return { status: "invalid", qty: null, chargedQty: null };
  if (input.weighed) {
    const min = input.window ? parseQty(input.window.min) : null;
    const max = input.window ? parseQty(input.window.max) : null;
    if (max !== null && picked > max) return { status: "over_window", qty, chargedQty: fmtQty(max) };
    if (min !== null && picked < min) return { status: "short", qty, chargedQty: qty };
    return { status: "full", qty, chargedQty: qty };
  }
  if (picked > ordered) return { status: "over_ordered", qty, chargedQty: null };
  return { status: picked < ordered ? "short" : "full", qty, chargedQty: qty };
}

export interface PriceImpact {
  /** Estimated line total for the quantity the customer will be charged for. */
  charged: string;
  /** Charged minus the estimate the customer saw at checkout (negative = customer pays less). */
  difference: string;
}

export function priceImpact(unitPrice: string, chargedQty: string | null, estimatedLine: string): PriceImpact | null {
  const charged = lineTotal(unitPrice, chargedQty);
  const diff = charged === null ? null : subMoney(charged, estimatedLine);
  return charged === null || diff === null ? null : { charged, difference: diff };
}

/** Step for the +/- buttons: whole numbers for counted items, otherwise the finest decimal place of the ordered quantity. */
export function stepFor(ordered: string): string {
  const q = parseQty(ordered);
  if (q === null || q % 1000n === 0n) return "1";
  if (q % 100n === 0n) return "0.1";
  if (q % 10n === 0n) return "0.01";
  return "0.001";
}

/** Move a typed quantity by +/- one step, clamped at zero and (optionally) at `max`. Returns the new canonical string. */
export function stepQty(current: string, delta: 1 | -1, step: string, max?: string): string {
  const cur = parseQty(current) ?? 0n;
  const st = parseQty(step) ?? 1000n;
  let next = cur + BigInt(delta) * st;
  if (next < 0n) next = 0n;
  const cap = max ? parseQty(max) : null;
  if (cap !== null && next > cap) next = cap;
  return fmtQty(next);
}

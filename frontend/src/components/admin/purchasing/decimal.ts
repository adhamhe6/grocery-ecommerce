// Exact decimal arithmetic on the API's decimal *strings* ("12.50", "0.125"). No floats are ever involved, so purchase
// order totals and stock maths match the server (which uses Python Decimal with ROUND_HALF_UP) to the last digit.

/** value = n / 10^s */
interface Dec { n: bigint; s: number }

const RE = /^([+-])?(\d+)?(?:\.(\d+))?$/;

function parse(input: string | null | undefined): Dec | null {
  if (input == null) return null;
  const text = String(input).trim();
  if (!text || text === "." || text === "+" || text === "-") return null;
  const m = RE.exec(text);
  if (!m) return null;
  const [, sign, whole = "", frac = ""] = m;
  if (!whole && !frac) return null;
  const n = BigInt(`${whole || "0"}${frac}`);
  return { n: sign === "-" ? -n : n, s: frac.length };
}

const pow10 = (k: number) => 10n ** BigInt(k);
const align = (a: Dec, b: Dec): [bigint, bigint, number] => {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
};

/** Round to `scale` decimal places, ties away from zero (Python's ROUND_HALF_UP). */
function roundTo(d: Dec, scale: number): Dec {
  if (d.s <= scale) return { n: d.n * pow10(scale - d.s), s: scale };
  const div = pow10(d.s - scale);
  const neg = d.n < 0n;
  const abs = neg ? -d.n : d.n;
  let q = abs / div;
  if ((abs % div) * 2n >= div) q += 1n;
  return { n: neg ? -q : q, s: scale };
}

function format(d: Dec, scale?: number): string {
  const r = scale === undefined ? d : roundTo(d, scale);
  const neg = r.n < 0n;
  const digits = (neg ? -r.n : r.n).toString().padStart(r.s + 1, "0");
  const whole = r.s ? digits.slice(0, -r.s) : digits;
  const frac = r.s ? digits.slice(-r.s) : "";
  const text = frac ? `${whole}.${frac}` : whole;
  return neg && /[1-9]/.test(text) ? `-${text}` : text;
}

function trimmed(d: Dec): string {
  const text = format(d);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** True when `value` is a plain decimal string (optionally signed). Blank is not valid. */
export const isDecimal = (value: string | null | undefined): boolean => parse(value) !== null;

/** Number of digits after the decimal point (0 when invalid). */
export const decimalPlaces = (value: string): number => parse(value)?.s ?? 0;

/** Compare two decimal strings: -1, 0 or 1; null when either is not a number. */
export function cmpDec(a: string, b: string): -1 | 0 | 1 | null {
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  const [p, q] = align(x, y);
  return p < q ? -1 : p > q ? 1 : 0;
}

export function addDec(a: string, b: string): string | null {
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  const [p, q, s] = align(x, y);
  return trimmed({ n: p + q, s });
}

export function subDec(a: string, b: string): string | null {
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  const [p, q, s] = align(x, y);
  return trimmed({ n: p - q, s });
}

/** Exact product, trimmed of trailing zeros. */
export function mulDec(a: string, b: string): string | null {
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  return trimmed({ n: x.n * y.n, s: x.s + y.s });
}

/** Round a decimal string to `scale` places (half away from zero) and always show exactly that many places. */
export function toFixedDec(value: string, scale: number): string | null {
  const d = parse(value);
  return d ? format(d, scale) : null;
}

export const isPositive = (value: string): boolean => (cmpDec(value, "0") ?? -1) > 0;
export const isNegative = (value: string): boolean => (cmpDec(value, "0") ?? 1) < 0;

/** Canonical quantity text like the API's (`3`, `0.25`, `1.5`); returns the input when it isn't a number. */
export function trimDec(value: string): string {
  const d = parse(value);
  return d ? trimmed(d) : value;
}

// --------------------------------------------------------------------------------------------- purchase orders
export interface PoLineInput { qty: string; unitCost: string }

/** qty × unit cost, exact (never rounded): `null` while either side is blank or invalid. */
export function lineExact(qty: string, unitCost: string): string | null {
  return mulDec(qty, unitCost);
}

/** The line amount shown to staff: exact product rounded to cents. */
export function lineTotal(qty: string, unitCost: string): string | null {
  const exact = lineExact(qty, unitCost);
  return exact === null ? null : toFixedDec(exact, 2);
}

/**
 * Order total exactly as the server computes it: sum of the exact line products, rounded to cents once
 * (apps/purchasing/admin_api.py `po_row`). Incomplete rows (blank/invalid) count as zero.
 */
export function orderTotal(lines: PoLineInput[]): string {
  let sum: Dec = { n: 0n, s: 0 };
  for (const l of lines) {
    const x = parse(l.qty), y = parse(l.unitCost);
    if (!x || !y) continue;
    const p: Dec = { n: x.n * y.n, s: x.s + y.s };
    const [a, b, s] = align(sum, p);
    sum = { n: a + b, s };
  }
  return format(sum, 2);
}

/** Sum of exact decimal strings, trimmed; invalid entries are skipped. */
export function sumDec(values: string[]): string {
  let sum: Dec = { n: 0n, s: 0 };
  for (const v of values) {
    const x = parse(v);
    if (!x) continue;
    const [a, b, s] = align(sum, x);
    sum = { n: a + b, s };
  }
  return trimmed(sum);
}

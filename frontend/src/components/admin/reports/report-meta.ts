// What the API does NOT send but a reader needs to interpret a report correctly. Everything here was written from
// backend/apps/reports/queries.py; the DEFINITIONS text is a verbatim copy of the module docstring there (a test keeps it
// in sync). The API sends each report's title, columns, rows and a free-form `summary`; nothing in this file adds numbers.

import type { ColumnKind } from "./report-format";

export const DEFINITIONS_INTRO = "Every number is computed from persisted rows; nothing is estimated.";

/** term – definition, exactly as in the docstring at the top of apps/reports/queries.py. */
export const DEFINITIONS: { term: string; text: string }[] = [
  { term: "Accepted order", text: "confirmed and not cancelled/failed: CONFIRMED … COMPLETED. Counted by `placed_at`." },
  { term: "Gross sales", text: "Σ amount due of accepted orders (the final weighed total once known, else the estimate). Includes delivery and tax." },
  { term: "Discounts", text: "Σ coupon discounts + Σ promotion savings on accepted orders (money the customer did NOT pay)." },
  { term: "Refunds", text: "Σ refunds with status SUCCEEDED, counted by completion date. Pending or failed refunds are never counted." },
  { term: "Settled revenue", text: "cash basis: Σ captured/collected payments (by capture date) minus refunds completed in the same period." },
  { term: "Net sales", text: "gross sales of COMPLETED orders (by completion date) minus refunds completed in the period." },
  { term: "AOV", text: "gross sales ÷ accepted orders." },
  { term: "Waste value", text: "Σ |WASTE movements| × unit cost where a cost is on record; movements with no cost are counted separately." },
  { term: "Inventory value", text: "Σ remaining batch quantity × batch unit cost, plus unbatched stock at the average cost of its RECEIPT movements. Lines with no cost on record are excluded and reported as `unvalued_lines`." },
];

export interface ReportNote {
  /** One line for the reports index. */
  blurb: string;
  /** Bullet points shown under "About this report". */
  notes: string[];
  /** The report is a snapshot of current stock / ignores the date range. */
  ignoresPeriod?: boolean;
  /** The store switcher doesn't change this report. */
  ignoresStore?: boolean;
  /** The API returns at most this many rows (per section); a full table means more exist. */
  rowCap?: number;
}

export const REPORT_NOTES: Record<string, ReportNote> = {
  sales: {
    blurb: "Orders, gross sales, discounts, delivery fees and refunds for each day.",
    notes: [
      "One row per day that had at least one accepted order, by the day the order was placed in the store's time zone. Days without orders have no row (the chart shows them as zero).",
      "The Refunds column counts refunds completed on that day, but only on days that also had accepted orders. Use the totals above for the full period figure.",
      "The totals use the definitions below across the whole period, so they are not the sum of the rows in every case (net sales and settled revenue are counted by completion and capture dates).",
    ],
  },
  products: {
    blurb: "Units and revenue per product, best sellers first.",
    rowCap: 500,
    notes: [
      "Accepted orders placed in the period. Lines that were removed, substituted away or are still only proposed are left out.",
      "Units are the picked quantity once an item is picked, otherwise the ordered quantity. Revenue is the final line total once known, otherwise the estimate (before delivery fees).",
      "Limited to the top 500 products by revenue.",
    ],
  },
  categories: {
    blurb: "Revenue and share of sales per category.",
    rowCap: 500,
    notes: [
      "Same order lines as the product report, grouped by category. Lines with no category appear as “—”.",
      "Share % is each row's part of the revenue of the rows listed here (line totals, so it excludes delivery fees).",
    ],
  },
  brands: {
    blurb: "Revenue and share of sales per brand.",
    rowCap: 500,
    notes: [
      "Same order lines as the product report, grouped by brand. Products with no brand appear as “—”.",
      "Share % is each row's part of the revenue of the rows listed here (line totals, so it excludes delivery fees).",
    ],
  },
  branches: {
    blurb: "How each store performed: orders, sales, cancellations and on-time delivery.",
    notes: [
      "Accepted orders placed in the period, per store. Cancelled counts orders cancelled in the period, by cancellation date.",
      "On-time deliveries % is the share of completed delivery orders finished by the end of their slot. Blank means there were no completed deliveries with a slot.",
      "Avg pick→ready is the average minutes between picking starting and the order being ready, for completed orders that have both times.",
    ],
  },
  "inventory-valuation": {
    blurb: "What the stock on hand is worth at cost, per store and product.",
    ignoresPeriod: true,
    notes: [
      "This is a snapshot of stock on hand now. The date range does not change it.",
      "Products tracked by batch are valued from their batches' unit costs; otherwise (or when no batch has a cost) the average cost of goods received is used. Lines with no cost on record have a blank value, are excluded from the total and are counted as lines with no cost.",
    ],
  },
  "stock-adjustments": {
    blurb: "Manual stock adjustments, transfers and returns, with who made them and why.",
    rowCap: 2000,
    notes: [
      "Adjustments, transfers in and out, and returns recorded in the period, newest first. “Change” is the quantity added (+) or removed (−).",
      "Limited to the most recent 2,000 movements.",
    ],
  },
  "expiry-losses": {
    blurb: "Waste and expired stock written off, valued at cost.",
    rowCap: 2000,
    notes: [
      "Waste movements recorded in the period, newest first. Value is quantity × the movement's unit cost, otherwise its batch's cost. Movements with no cost on record have a blank value and are counted separately in the summary.",
      "Limited to the most recent 2,000 movements.",
    ],
  },
  suppliers: {
    blurb: "How reliably each supplier delivered: fill rate, rejections and on-time receipts.",
    ignoresStore: true,
    notes: [
      "Covers purchase orders submitted from the start date onwards (the end date and the store switcher don't apply). Draft and cancelled orders are ignored.",
      "Fill rate = quantity received ÷ quantity ordered. Rejected % = quantity rejected ÷ (received + rejected). On time % = receipts on or before the purchase order's expected date. A blank cell means there is no data yet.",
      "Quoted lead time is the supplier's own figure, not a measurement.",
    ],
  },
  promotions: {
    blurb: "How often each coupon and promotion was used and what it saved customers.",
    notes: [
      "Coupons: redemptions in the period that are still active, with the discount given. Promotions: accepted order lines carrying a promotion label, with the saving against list price.",
      "Customer saving is money the customer did not pay; it is not the same as lost margin.",
    ],
  },
  refunds: {
    blurb: "Refunds raised and orders cancelled in the period.",
    rowCap: 2000,
    notes: [
      "Lists every refund created in the period whatever its status, then every order cancelled in the period (amount = the order total). Only completed refunds count towards the Refunds figure in the definitions.",
      "Each section is limited to 2,000 rows.",
    ],
  },
  delivery: {
    blurb: "Delivery slot capacity and booking, plus on-time performance.",
    notes: [
      "One row per date, store and slot type for slots dated within the range. Utilisation % = booked ÷ capacity.",
      "The totals show completed deliveries in the period, the share finished by the end of their slot, and average pick→ready minutes.",
    ],
  },
  customers: {
    blurb: "How many customers ordered, how many came back, and what they spent.",
    rowCap: 500,
    notes: [
      "Customers with accepted orders in the period, grouped by account and contact email (guest orders by email). Email addresses are masked. A repeat customer placed more than one accepted order in the period.",
      "The table is limited to the top 500 by spend. In the orders-per-customer breakdown, “5” means five or more orders.",
    ],
  },
};

export interface SummarySpec { label: string; kind: ColumnKind; primary?: boolean; hint?: string }

/** Labels and number kinds for each report's free-form `summary` object (keys as returned by the API). */
export const SUMMARY_SPECS: Record<string, Record<string, SummarySpec>> = {
  sales: {
    gross_sales: { label: "Gross sales", kind: "money", primary: true },
    orders: { label: "Accepted orders", kind: "int", primary: true },
    aov: { label: "Average order value", kind: "money", primary: true },
    net_sales: { label: "Net sales", kind: "money", primary: true, hint: "completed orders minus refunds" },
    settled_revenue: { label: "Settled revenue", kind: "money", hint: "cash basis" },
    discounts: { label: "Discounts", kind: "money" },
    coupon_discounts: { label: "of which coupons", kind: "money" },
    promo_savings: { label: "of which promotions", kind: "money" },
    delivery_fees: { label: "Delivery fees", kind: "money" },
    refunds: { label: "Refunds completed", kind: "money" },
    completed_orders: { label: "Completed orders", kind: "int" },
  },
  categories: { revenue: { label: "Revenue listed", kind: "money", primary: true } },
  brands: { revenue: { label: "Revenue listed", kind: "money", primary: true } },
  "inventory-valuation": {
    total_value: { label: "Total stock value", kind: "money", primary: true },
    unvalued_lines: { label: "Lines with no cost", kind: "int", primary: true, hint: "excluded from the total" },
  },
  "expiry-losses": {
    total_value: { label: "Total loss at cost", kind: "money", primary: true },
    movements_without_cost: { label: "Movements with no cost", kind: "int", primary: true, hint: "not valued" },
  },
  delivery: {
    completed_deliveries: { label: "Completed deliveries", kind: "int", primary: true },
    on_time_rate: { label: "On time", kind: "pct", primary: true, hint: "finished by slot end" },
    avg_pick_to_ready_minutes: { label: "Avg pick → ready", kind: "qty", primary: true, hint: "minutes" },
  },
  refunds: { refunds_completed: { label: "Refunds completed", kind: "money", primary: true, hint: "in the period" } },
  customers: {
    customers: { label: "Customers", kind: "int", primary: true },
    repeat_customers: { label: "Repeat customers", kind: "int", primary: true },
    repeat_rate_pct: { label: "Repeat rate", kind: "pct", primary: true },
  },
};

/** Which chart suits which report. Rows are read from the same payload as the table. */
export type ChartSpec =
  | { type: "trend"; title: string; x: string; y: string; yKind: ColumnKind }
  | { type: "ranked"; title: string; label: string[]; y: string; yKind: ColumnKind; limit: number };

export const CHARTS: Record<string, ChartSpec> = {
  sales: { type: "trend", title: "Gross sales by day", x: "date", y: "gross_sales", yKind: "money" },
  products: { type: "ranked", title: "Top products by revenue", label: ["name"], y: "revenue", yKind: "money", limit: 10 },
  categories: { type: "ranked", title: "Revenue by category", label: ["category"], y: "revenue", yKind: "money", limit: 10 },
  brands: { type: "ranked", title: "Revenue by brand", label: ["brand"], y: "revenue", yKind: "money", limit: 10 },
  branches: { type: "ranked", title: "Gross sales by store", label: ["branch"], y: "gross_sales", yKind: "money", limit: 10 },
  promotions: { type: "ranked", title: "Customer saving by coupon or promotion", label: ["type", "name"], y: "customer_saving", yKind: "money", limit: 10 },
  "inventory-valuation": { type: "ranked", title: "Highest-value stock lines", label: ["name", "branch"], y: "value", yKind: "money", limit: 10 },
  "expiry-losses": { type: "ranked", title: "Largest losses at cost", label: ["name", "lot"], y: "value", yKind: "money", limit: 10 },
};

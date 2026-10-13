import { describe, expect, it } from "vitest";
import { buildChart, columnKind, compareCells, formatCell, isNumericKind, sortRows, summaryItems, type CellFormat } from "@/components/admin/reports/report-format";

const f: CellFormat = { locale: "en-US", money: (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v)) };

describe("columnKind", () => {
  it("reads the API's `type`, falls back to `kind`, and treats anything unknown as text", () => {
    expect(columnKind({ type: "money" })).toBe("money");
    expect(columnKind({ kind: "pct" })).toBe("pct");
    expect(columnKind({ type: "PCT" })).toBe("pct");
    expect(columnKind({ type: "weird" })).toBe("text");
    expect(columnKind({})).toBe("text");
  });
  it("right-aligns numbers only", () => {
    expect(["int", "money", "qty", "pct"].every((k) => isNumericKind(k as never))).toBe(true);
    expect(isNumericKind("text")).toBe(false);
    expect(isNumericKind("date")).toBe(false);
  });
});

describe("formatCell by kind", () => {
  it("money uses the store currency formatter", () => {
    expect(formatCell("money", "1234.5", f)).toBe("$1,234.50");
    expect(formatCell("money", "0.00", f)).toBe("$0.00");
    expect(formatCell("money", 7, f)).toBe("$7.00");
  });
  it("int groups thousands and drops decimals", () => {
    expect(formatCell("int", 12345, f)).toBe("12,345");
    expect(formatCell("int", "3", f)).toBe("3");
  });
  it("qty keeps up to 3 decimals and no trailing zeros", () => {
    expect(formatCell("qty", "1.620", f)).toBe("1.62");
    expect(formatCell("qty", "2", f)).toBe("2");
    expect(formatCell("qty", "0.125", f)).toBe("0.125");
  });
  it("pct shows one decimal and a percent sign", () => {
    expect(formatCell("pct", "12.34", f)).toBe("12.3%");
    expect(formatCell("pct", "100", f)).toBe("100%");
    expect(formatCell("pct", "0.0", f)).toBe("0%");
  });
  it("date renders a calendar date without timezone drift", () => {
    expect(formatCell("date", "2026-03-01", f)).toBe("Mar 1, 2026");
    expect(formatCell("date", "2026-12-31", f)).toBe("Dec 31, 2026");
    expect(formatCell("date", "not a date", f)).toBe("not a date");
  });
  it("text passes through", () => {
    expect(formatCell("text", "Whole milk 2L", f)).toBe("Whole milk 2L");
  });
  it("blank values (the API's 'no data') show as an em dash for every kind", () => {
    for (const kind of ["text", "date", "int", "money", "qty", "pct"] as const) {
      expect(formatCell(kind, "", f)).toBe("—");
      expect(formatCell(kind, null, f)).toBe("—");
      expect(formatCell(kind, undefined, f)).toBe("—");
    }
  });
  it("shows a non-numeric value in a numeric column as-is instead of NaN", () => {
    expect(formatCell("money", "n/a", f)).toBe("n/a");
    expect(formatCell("int", "—", f)).toBe("—");
  });
});

describe("sorting", () => {
  const rows = [{ n: "10", s: "b" }, { n: "9", s: "a" }, { n: "", s: "c" }, { n: "100", s: "" }];
  it("sorts numerically for numeric kinds (10 > 9) and puts blanks last in both directions", () => {
    const col = { key: "n", label: "N", type: "int" };
    expect(sortRows(rows, col, false).map((r) => r.n)).toEqual(["9", "10", "100", ""]);
    expect(sortRows(rows, col, true).map((r) => r.n)).toEqual(["100", "10", "9", ""]);
  });
  it("sorts text naturally and case-insensitively", () => {
    const col = { key: "s", label: "S" };
    expect(sortRows(rows, col, false).map((r) => r.s)).toEqual(["a", "b", "c", ""]);
    expect(compareCells("text", "item 2", "item 10")).toBeLessThan(0);
  });
  it("does not mutate the input", () => {
    const before = rows.map((r) => r.n);
    sortRows(rows, { key: "n", label: "N", type: "int" }, true);
    expect(rows.map((r) => r.n)).toEqual(before);
  });
});

describe("summaryItems", () => {
  it("labels and formats the sales summary and puts headline figures first", () => {
    const { items } = summaryItems("sales", { orders: 4, gross_sales: "51.94", aov: "12.99", discounts: "2.00", refunds: "3.00", net_sales: "39.44", completed_orders: 3 }, f);
    expect(items.filter((i) => i.primary).map((i) => [i.label, i.text])).toEqual([
      ["Gross sales", "$51.94"], ["Accepted orders", "4"], ["Average order value", "$12.99"], ["Net sales", "$39.44"],
    ]);
    expect(items.find((i) => i.key === "refunds")).toMatchObject({ label: "Refunds completed", text: "$3.00", primary: false });
  });
  it("shows null totals as a dash and unknown keys as plain text with a readable label", () => {
    const { items } = summaryItems("sales", { aov: null, brand_new_metric: "7" }, f);
    expect(items.find((i) => i.key === "aov")?.text).toBe("—");
    expect(items.find((i) => i.key === "brand_new_metric")).toMatchObject({ label: "Brand new metric", text: "7" });
  });
  it("turns the orders-per-customer object into an ordered distribution", () => {
    const { items, distributions } = summaryItems("customers", { customers: 10, repeat_rate_pct: "40.0", orders_per_customer_distribution: { "5": 1, "1": 6, "2": 3 } }, f);
    expect(items.map((i) => i.text)).toEqual(["10", "40%"]);
    expect(distributions[0].entries).toEqual([
      { label: "1 order", value: 6 }, { label: "2 orders", value: 3 }, { label: "5 or more orders", value: 1 },
    ]);
  });
  it("formats the inventory valuation summary (mixed string and number values)", () => {
    const { items } = summaryItems("inventory-valuation", { total_value: "15.00", unvalued_lines: 1 }, f);
    expect(items.map((i) => [i.label, i.text])).toEqual([["Total stock value", "$15.00"], ["Lines with no cost", "1"]]);
  });
});

describe("buildChart", () => {
  it("sales: a time series sorted by date", () => {
    const chart = buildChart("sales", [
      { date: "2026-03-02", gross_sales: "30.00" }, { date: "2026-03-01", gross_sales: "20.00" },
    ]);
    expect(chart).toMatchObject({ type: "trend", points: [{ date: "2026-03-01", value: 20 }, { date: "2026-03-02", value: 30 }] });
  });
  it("products: top 10 by revenue, zero and blank values dropped, labels made unique", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, revenue: String(100 - i) })),
      { name: "Free", revenue: "0.00" }, { name: "Blank", revenue: "" }, { name: "P0", revenue: "50" },
    ];
    const chart = buildChart("products", rows);
    expect(chart?.type).toBe("ranked");
    if (chart?.type !== "ranked") throw new Error("expected ranked");
    expect(chart.points).toHaveLength(10);
    expect(chart.points[0]).toEqual({ label: "P0", value: 100 });
    expect(new Set(chart.points.map((p) => p.label)).size).toBe(10);
  });
  it("duplicate labels get a suffix so they can be used as keys", () => {
    const chart = buildChart("categories", [{ category: "Dairy", revenue: "9" }, { category: "Dairy", revenue: "5" }]);
    if (chart?.type !== "ranked") throw new Error("expected ranked");
    expect(chart.points.map((p) => p.label)).toEqual(["Dairy", "Dairy (2)"]);
  });
  it("returns null when there is nothing to draw or no chart suits the report", () => {
    expect(buildChart("sales", [])).toBeNull();
    expect(buildChart("customers", [{ customer: "a***@b.c", spend: "5.00" }])).toBeNull();
    expect(buildChart("products", [{ name: "x", revenue: "0.00" }])).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { buildCompareRows, type Cell, type CompareRow } from "@/lib/compare";
import { card, compareProduct, detail, money, ok, response } from "./fixtures";

const find = (rows: CompareRow[], key: string) => rows.find((r) => r.key === key)!;
const text = (c: Cell) => (c.kind === "value" ? c.text : c.kind);

const milk = compareProduct({ card: card({ id: 1, name: "Whole milk", price: "1.20", base_price: "1.20", unit_price: { amount: "1.20", per: "L" }, pack_label: "each · 1 L" }), brand: "Dairy Co", size: "1 L", origin: "Ireland", storage: "Chilled", nutrition_per_100: { energy_kcal: "64.0", sugars: "4.7", protein: "3.4", basis: "per 100 ml" } });
const bread = compareProduct({ card: card({ id: 2, name: "Sourdough", price: "3.00", base_price: "3.00", unit_price: null, pack_label: "each" }), size: null });

describe("buildCompareRows", () => {
  it("never leaves a cell blank: missing facts are explicit unknowns", () => {
    const { rows } = buildCompareRows(response([milk, bread]), {}, money);
    expect(find(rows, "unit-price").cells.map(text)).toEqual(["$1.20 / L", "unknown"]);
    expect(find(rows, "brand").cells.map(text)).toEqual(["Dairy Co", "unknown"]);
    expect(find(rows, "origin").cells.map(text)).toEqual(["Ireland", "unknown"]);
    for (const row of rows) for (const cell of row.cells) expect(["value", "unknown", "loading", "error"]).toContain(cell.kind);
  });

  it("formats price with the sale unit, the was-price and the promotion", () => {
    const deal = compareProduct({ card: card({ id: 3, price: "1.50", base_price: "2.00", promotion: { id: 1, label: "25% off", kind: "PERCENT_OFF", params: {} }, sale_unit: { code: "kg", symbol: "kg", name: "Kilogram", kind: "WEIGHT" }, is_variable_weight: true }) });
    const cell = find(buildCompareRows(response([deal]), {}, money).rows, "price").cells[0];
    expect(cell).toEqual({ kind: "value", text: "$1.50 / kg", note: "Was $2.00 · 25% off · Priced by weight" });
  });

  it("flags the best value product the API picked", () => {
    const { rows } = buildCompareRows(response([milk, bread], { best_value_id: 1 }), {}, money);
    const [a, b] = find(rows, "unit-price").cells;
    expect(a).toMatchObject({ kind: "value", badge: "Best value" });
    expect(b.kind).toBe("unknown");
  });

  it("does not repeat the net content when the pack label already has it", () => {
    const { rows } = buildCompareRows(response([milk, bread]), {}, money);
    expect(find(rows, "pack").cells.map(text)).toEqual(["each · 1 L", "each"]);
  });

  it("shows availability as text with a tone", () => {
    const low = compareProduct({ card: card({ id: 4, availability: { status: "LOW_STOCK", max_orderable: "3", can_order: true } }) });
    const out = compareProduct({ card: card({ id: 5, availability: { status: "OUT_OF_STOCK", max_orderable: null, can_order: false } }) });
    const cells = find(buildCompareRows(response([milk, low, out]), {}, money).rows, "availability").cells;
    expect(cells).toEqual([
      { kind: "value", text: "In stock", tone: "ok" },
      { kind: "value", text: "Low stock", tone: "warn" },
      { kind: "value", text: "Out of stock", tone: "bad" },
    ]);
  });

  describe("allergens (only available from the product detail)", () => {
    it("is loading until the detail arrives, and says so if it can't load", () => {
      const loading = find(buildCompareRows(response([milk]), { [milk.card.slug]: { status: "loading" } }, money).rows, "allergens").cells[0];
      const failed = find(buildCompareRows(response([milk]), { [milk.card.slug]: { status: "error" } }, money).rows, "allergens").cells[0];
      expect(loading.kind).toBe("loading");
      expect(failed.kind).toBe("error");
    });

    it("never claims 'no allergens' when the data isn't confirmed", () => {
      const d = ok(detail({ id: 1, allergens: { contains: [], may_contain: [], confirmed: false } }));
      const cell = find(buildCompareRows(response([milk]), { [milk.card.slug]: d }, money).rows, "allergens").cells[0];
      expect(cell).toMatchObject({ kind: "unknown", note: expect.stringContaining("Check the packaging") });
    });

    it("lists confirmed allergens and may-contain separately", () => {
      const d = ok(detail({ id: 1, allergens: { contains: ["Milk"], may_contain: ["Nuts", "Soy"], confirmed: true } }));
      const cell = find(buildCompareRows(response([milk]), { [milk.card.slug]: d }, money).rows, "allergens").cells[0];
      expect(cell).toEqual({ kind: "value", text: "Contains Milk", note: "May contain Nuts, Soy" });
    });

    it("confirmed with nothing declared reads as none of the 14 major allergens", () => {
      const d = ok(detail({ id: 1, allergens: { contains: [], may_contain: [], confirmed: true } }));
      const cell = find(buildCompareRows(response([milk]), { [milk.card.slug]: d }, money).rows, "allergens").cells[0];
      expect(cell).toMatchObject({ kind: "value", text: "Contains none of the 14 major allergens" });
    });
  });

  describe("nutrition", () => {
    it("uses the comparison endpoint's values straight away, then the detail's full table", () => {
      const early = buildCompareRows(response([milk]), { [milk.card.slug]: { status: "loading" } }, money).rows;
      expect(find(early, "nutrition-energy_kcal").cells.map(text)).toEqual(["64 kcal"]);
      expect(find(early, "nutrition-fat").cells[0].kind).toBe("loading");

      const full = ok(detail({ id: 1, nutrition: { basis: "per 100 ml", source: "x", is_demo: false, values: { energy_kcal: "64.0", fat: "3.6", saturates: "2.3", sugars: "4.7", protein: "3.4", salt: "0.100" } } }));
      const late = buildCompareRows(response([milk]), { [milk.card.slug]: full }, money).rows;
      expect(find(late, "nutrition-fat").cells.map(text)).toEqual(["3.6 g"]);
      expect(find(late, "nutrition-salt").cells.map(text)).toEqual(["0.1 g"]);
      expect(late.some((r) => r.key === "nutrition-fibre")).toBe(false); // nobody has fibre: no empty row
      expect(find(late, "nutrition-basis").cells.map(text)).toEqual(["per 100 ml"]);
    });

    it("products without a nutrition record are unknown, not zero", () => {
      const rows = buildCompareRows(response([milk, bread]), { [bread.card.slug]: { status: "loading" } }, money).rows;
      expect(find(rows, "nutrition-energy_kcal").cells.map(text)).toEqual(["64 kcal", "unknown"]);
      expect(find(rows, "nutrition-basis").cells.map(text)).toEqual(["per 100 ml", "unknown"]);
    });

    it("warns when products use different bases", () => {
      const crisps = compareProduct({ card: card({ id: 6 }), nutrition_per_100: { energy_kcal: "520", sugars: "1", protein: "6", basis: "per 100 g" } });
      expect(buildCompareRows(response([milk, crisps]), {}, money).notices).toEqual(["Nutrition values are given on different bases (per 100 ml, per 100 g), so compare them with care."]);
      expect(buildCompareRows(response([milk, milk]), {}, money).notices).toEqual([]);
    });
  });

  describe("origin and storage", () => {
    it("adds the origin note from the detail", () => {
      const d = ok(detail({ id: 1, origin: { country: "Ireland", note: "Cork" } }));
      const cell = find(buildCompareRows(response([milk]), { [milk.card.slug]: d }, money).rows, "origin").cells[0];
      expect(cell).toEqual({ kind: "value", text: "Ireland", note: "Cork" });
    });

    it("waits for the detail when only it could know the origin", () => {
      const cell = find(buildCompareRows(response([bread]), { [bread.card.slug]: { status: "loading" } }, money).rows, "origin").cells[0];
      expect(cell.kind).toBe("loading");
    });

    it("storage instructions are unknown when the producer gave none", () => {
      const d = ok(detail({ id: 1, storage_instructions: "" }));
      const rows = buildCompareRows(response([milk]), { [milk.card.slug]: d }, money).rows;
      expect(find(rows, "storage").cells.map(text)).toEqual(["Chilled"]);
      expect(find(rows, "storage-instructions").cells.map(text)).toEqual(["unknown"]);
    });
  });

  it("only lists verified claims and says so when there are none", () => {
    const organic = compareProduct({ card: card({ id: 7 }), claims: ["Organic", "Vegan"] });
    const cells = find(buildCompareRows(response([organic, bread]), {}, money).rows, "claims").cells;
    expect(cells.map(text)).toEqual(["Organic, Vegan", "None verified"]);
  });
});

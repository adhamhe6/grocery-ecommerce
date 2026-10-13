import { describe, expect, it } from "vitest";
import {
  NUTRIENTS, buildAllergensPayload, buildClaimsPayload, buildCorePayload, buildNutritionPayload, categoryGroups, diffPayload, dirtySections, emptyProductForm, labelFor,
  mapAllergenErrors, mapClaimErrors, mapCoreErrors, mapNutritionErrors, productToForm, validateProductForm, type CategoryRow, type ProductDetail,
} from "@/components/admin/catalog/product-model";

const filled = () => {
  const f = emptyProductForm();
  Object.assign(f.core, { name: "  Gala apples ", sku: " APL-1 ", category: "12", saleUnit: "3", price: " 2.50 " });
  return f;
};

describe("buildCorePayload", () => {
  it("trims text, turns ids into numbers and blank optionals into null (never empty strings)", () => {
    const body = buildCorePayload(filled().core);
    expect(body).toMatchObject({ name: "Gala apples", sku: "APL-1", category: 12, sale_unit: 3, price: "2.50", brand: null, barcode: null, qty_max: null, net_content: null, net_content_unit: null });
    expect(body).not.toHaveProperty("slug"); // blank slug: the server builds a unique one
  });

  it("sends a slug only when one was typed, and keeps numbers as decimal strings", () => {
    const f = filled();
    f.core.slug = " gala-apples ";
    f.core.qtyMin = "0.5";
    f.core.qtyMax = "10";
    f.core.netContent = "500";
    f.core.netContentUnit = "7";
    f.core.brand = "4";
    f.core.barcode = " 5012345678900 ";
    expect(buildCorePayload(f.core)).toMatchObject({ slug: "gala-apples", qty_min: "0.5", qty_max: "10", net_content: "500", net_content_unit: 7, brand: 4, barcode: "5012345678900" });
  });

  it("passes non-numeric ids through so the API can explain them", () => {
    const f = filled();
    f.core.sellBufferDays = "soon";
    expect(buildCorePayload(f.core).sell_buffer_days).toBe("soon");
  });

  it("does not carry allergen confirmation (that belongs to the allergens call)", () => {
    expect(buildCorePayload(filled().core)).not.toHaveProperty("allergen_info_complete");
  });
});

describe("diffPayload", () => {
  it("keeps only the keys that changed", () => {
    const base = buildCorePayload(filled().core);
    const f = filled();
    f.core.price = "2.75";
    f.core.originCountry = "UK";
    expect(diffPayload(base, buildCorePayload(f.core))).toEqual({ price: "2.75", origin_country: "UK" });
  });
});

describe("claims, allergens and nutrition payloads", () => {
  it("lists only claimed kinds, in a stable order, with trimmed evidence", () => {
    const f = emptyProductForm();
    f.claims.ORGANIC = { status: "verified", evidence: " Cert 123 ", verifiedBy: null, verifiedAt: null };
    f.claims.VEGAN = { status: "claimed", evidence: "", verifiedBy: null, verifiedAt: null };
    expect(buildClaimsPayload(f.claims)).toEqual([
      { kind: "VEGAN", verified: false, evidence: "" },
      { kind: "ORGANIC", verified: true, evidence: "Cert 123" },
    ]);
    expect(buildClaimsPayload(emptyProductForm().claims)).toEqual([]);
  });

  it("builds the allergen list from the lookup order and sends the confirmation flag", () => {
    const body = buildAllergensPayload({ levels: { sesame: "MAY_CONTAIN", milk: "CONTAINS", eggs: "" }, confirmed: true }, ["eggs", "milk", "sesame"]);
    expect(body).toEqual({ allergens: [{ allergen: "milk", level: "CONTAINS" }, { allergen: "sesame", level: "MAY_CONTAIN" }], allergen_info_complete: true });
  });

  it("sends blank nutrients as null — unknown is not zero", () => {
    const f = emptyProductForm();
    f.nutrition = { ...f.nutrition, enabled: true, basis: " per 100 g ", source: " label ", values: { ...f.nutrition.values, energy_kcal: "52", fat: "0" } };
    const body = buildNutritionPayload(f.nutrition);
    expect(body).toMatchObject({ basis: "per 100 g", source: "label", energy_kcal: "52", fat: "0", protein: null, salt: null });
    expect(Object.keys(body)).toHaveLength(2 + NUTRIENTS.length);
  });
});

describe("validateProductForm", () => {
  it("flags the obvious required fields", () => {
    const e = validateProductForm(emptyProductForm());
    expect(Object.keys(e).sort()).toEqual(["core.category", "core.name", "core.price", "core.saleUnit", "core.sku"]);
  });
  it("is quiet for a complete form", () => expect(validateProductForm(filled())).toEqual({}));
  it("requires evidence to verify a claim", () => {
    const f = filled();
    f.claims.HALAL = { status: "verified", evidence: "  ", verifiedBy: null, verifiedAt: null };
    expect(validateProductForm(f)).toHaveProperty(["claims.HALAL.evidence"]);
    f.claims.HALAL.evidence = "Certificate H-77";
    expect(validateProductForm(f)).toEqual({});
  });
  it("requires a source and basis only when a nutrition panel is switched on", () => {
    const f = filled();
    expect(validateProductForm(f)).toEqual({});
    f.nutrition.enabled = true;
    expect(Object.keys(validateProductForm(f)).sort()).toEqual(["nutrition.basis", "nutrition.source"]);
  });
});

describe("dirty tracking", () => {
  it("ignores whitespace and the evidence of unclaimed claims", () => {
    const base = filled();
    const next = filled();
    next.core.name = "Gala apples";
    next.claims.VEGAN.evidence = "typed then unclaimed";
    expect(dirtySections(next, base)).toEqual([]);
  });
  it("reports exactly the sections that changed", () => {
    const base = filled();
    const next = filled();
    next.core.price = "3";
    next.allergens.confirmed = true;
    next.claims.ORGANIC.status = "claimed";
    next.nutrition.enabled = true;
    expect(dirtySections(next, base).sort()).toEqual(["allergens", "claims", "core", "nutrition"]);
  });
  it("treats an untouched blank nutrition panel as unchanged", () => {
    const base = filled();
    const next = filled();
    next.nutrition.source = "typed but panel switched off";
    expect(dirtySections(next, base)).toEqual([]);
  });
});

describe("productToForm", () => {
  const detail = {
    id: 9, sku: "APL-1", slug: "gala", name: "Gala", short_description: "", description: "", category: 12, brand: null, barcode: null, product_type: "LOOSE_PRODUCE", storage_type: "AMBIENT", sale_unit: 3, price: "2.50", tax_rate: "0.00",
    qty_min: "0.5", qty_step: "0.5", qty_max: null, net_content: null, net_content_unit: null, is_variable_weight: true, stock_mode: "TRACKED", tracks_batches: false, is_perishable: true, sell_buffer_days: 2,
    status: "ACTIVE", is_available: true, is_featured: false, origin_country: "", origin_note: "", storage_instructions: "", ingredients: "", packaging: "", manufacturer: "", allergen_info_complete: true,
    images: [], claims: [{ kind: "ORGANIC", verified: true, evidence: "Cert 1", verified_by: "a@b.c", verified_at: "2026-01-01T00:00:00Z" }, { kind: "VEGAN", verified: false, evidence: "", verified_by: null, verified_at: null }],
    allergens: [{ allergen: "milk", name: "Milk", level: "CONTAINS" }], nutrition: { basis: "per 100 g", source: "label", is_demo: true, energy_kcal: "52", energy_kj: null, fat: null, saturates: null, carbohydrate: null, sugars: null, fibre: null, protein: null, salt: null },
  } as unknown as ProductDetail;

  it("maps API data to form state without inventing values", () => {
    const f = productToForm(detail);
    expect(f.core).toMatchObject({ category: "12", brand: "", barcode: "", qtyMax: "", netContent: "", sellBufferDays: "2", originCountry: "" });
    expect(f.claims.ORGANIC).toMatchObject({ status: "verified", evidence: "Cert 1", verifiedBy: "a@b.c" });
    expect(f.claims.VEGAN.status).toBe("claimed");
    expect(f.claims.HALAL.status).toBe("none");
    expect(f.allergens).toEqual({ levels: { milk: "CONTAINS" }, confirmed: true });
    expect(f.nutrition).toMatchObject({ enabled: true, basis: "per 100 g", isDemo: true });
    expect(f.nutrition.values.energy_kcal).toBe("52");
    expect(f.nutrition.values.protein).toBe("");
  });
  it("round-trips: an untouched form is not dirty and builds the same payload", () => {
    const f = productToForm(detail);
    expect(dirtySections(f, productToForm(detail))).toEqual([]);
    expect(diffPayload(buildCorePayload(productToForm(detail).core), buildCorePayload(f.core))).toEqual({});
  });
});

describe("server error mapping", () => {
  it("maps API field names onto form fields and keeps unknown keys aside", () => {
    const m = mapCoreErrors({ sku: "A product with this SKU already exists.", qty_max: "The maximum can't be below the minimum quantity.", short_description: "Too long.", search_text: "weird" });
    expect(m.fields).toEqual({ "core.sku": "A product with this SKU already exists.", "core.qtyMax": "The maximum can't be below the minimum quantity.", "core.shortDescription": "Too long." });
    expect(m.rest).toEqual({ search_text: "weird" });
  });
  it("names the claim a list error belongs to by its position in the request", () => {
    const m = mapClaimErrors({ "1.evidence": "Evidence is required." }, ["VEGAN", "ORGANIC"]);
    expect(m.fields).toEqual({ "claims.ORGANIC.evidence": "Evidence is required." });
    expect(mapClaimErrors({ claims: "Each claim can only be listed once." }, []).rest).toEqual({ claims: "Each claim can only be listed once." });
  });
  it("maps allergen list errors to the allergen code", () => {
    const m = mapAllergenErrors({ "allergens.0.allergen": "Object with code=unicorn does not exist.", allergens: "Each allergen can only be listed once." }, ["unicorn"]);
    expect(m.fields).toEqual({ "allergens.unicorn": "Object with code=unicorn does not exist.", allergens: "Each allergen can only be listed once." });
  });
  it("maps nutrition errors, including the saturates / sugars rules", () => {
    const m = mapNutritionErrors({ saturates: "Saturates can't exceed total fat.", source: "Required", other: "x" });
    expect(m.fields).toEqual({ "nutrition.saturates": "Saturates can't exceed total fat.", "nutrition.source": "Required" });
    expect(m.rest).toEqual({ other: "x" });
  });
  it("gives readable labels", () => {
    expect(labelFor("core.shortDescription")).toBe("Short description");
    expect(labelFor("claims.GLUTEN_FREE.evidence")).toBe("Gluten-free evidence");
    expect(labelFor("core.sku")).toBe("SKU");
    expect(labelFor("core.qtyMax")).toBe("Maximum quantity");
    expect(labelFor("nutrition.saturates")).toBe("of which saturates (g)");
    expect(labelFor("allergens.sesame")).toBe("Allergens");
  });
});

describe("categoryGroups", () => {
  const cat = (id: number, name: string, parent: number | null, sort = 100, active = true) => ({ id, name, parent, sort_order: sort, is_active: active }) as CategoryRow;
  const all = [cat(1, "Dairy", null, 2), cat(2, "Milk", 1), cat(3, "Eggs", 1, 50), cat(4, "Bakery", null, 1), cat(5, "Old", 1, 100, false)];
  it("groups categories under their department, ordered, and offers a department with no categories directly", () => {
    const g = categoryGroups(all);
    expect(g.map((x) => x.label)).toEqual(["Bakery", "Dairy"]);
    expect(g[0].options).toEqual([["4", "Bakery"]]);
    expect(g[1].options.map(([, l]) => l)).toEqual(["Eggs", "Milk", "Old (inactive)"]);
  });
  it("keeps the department selectable when a product already sits in it", () => {
    expect(categoryGroups(all, "1")[1].options[0]).toEqual(["1", "Dairy (department itself)"]);
  });
});

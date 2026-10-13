import type { CompareProduct, CompareResponse } from "@/lib/account-types";
import type { DetailState } from "@/lib/compare";
import type { ProductCardData, ProductDetailData } from "@/lib/types";

export function card(over: Partial<ProductCardData> & { id: number }): ProductCardData {
  return {
    sku: `SKU-${over.id}`,
    slug: `product-${over.id}`,
    name: `Product ${over.id}`,
    short_description: "",
    brand: null,
    category: { id: 1, name: "Pantry", slug: "pantry", parent_slug: null },
    image: null,
    price: "2.50",
    base_price: "2.50",
    promotion: null,
    sale_unit: { code: "each", symbol: "ea", name: "Each", kind: "COUNT" },
    pack_label: "each · 500 g",
    unit_price: { amount: "5.00", per: "kg" },
    quantity: { min: "1", step: "1", max: null },
    is_variable_weight: false,
    product_type: "PACKAGED",
    storage_type: "AMBIENT",
    availability: { status: "IN_STOCK", max_orderable: null, can_order: true },
    badges: [],
    rating: null,
    ...over,
  };
}

export function compareProduct(over: Partial<CompareProduct> & { card: ProductCardData }): CompareProduct {
  return { brand: null, size: "500 g", origin: null, storage: "Ambient", claims: [], nutrition_per_100: null, ...over };
}

export function response(products: CompareProduct[], over: Partial<CompareResponse> = {}): CompareResponse {
  return { products, unit_price_comparable: true, best_value_id: null, warnings: [], ...over };
}

export function detail(over: Partial<ProductDetailData> & { id: number }): ProductDetailData {
  return {
    ...card({ id: over.id }),
    description: "",
    images: [],
    origin: null,
    storage_instructions: "",
    ingredients: "",
    packaging: "",
    manufacturer: "",
    allergens: { contains: [], may_contain: [], confirmed: false },
    claims: [],
    nutrition: null,
    unknowns: [],
    is_perishable: false,
    breadcrumbs: [],
    is_demo: false,
    related: [],
    ...over,
  } as ProductDetailData;
}

export const ok = (data: ProductDetailData): DetailState => ({ status: "ok", data });
export const money = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "—" : `$${Number(v).toFixed(2)}`);

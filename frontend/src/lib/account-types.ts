// Shapes for the account, favourites, shopping-list and comparison endpoints (see backend/apps/cart/views.py).
// Kept apart from types.ts so account work never collides with edits to the shared shapes.

import type { Money, ProductCardData } from "./types";

/** `GET /favorites/` — `ids` includes every saved product, `products` only those that can currently be shown. */
export interface FavoritesResponse {
  ids: number[];
  products: ProductCardData[];
}

export interface ListItem {
  product_id: number;
  name: string;
  slug: string;
  /** Decimal string. The API normalises it with Decimal.normalize(), so 10 can arrive as "1E+1" — always go through Number(). */
  quantity: string;
}

export interface ShoppingList {
  id: number;
  name: string;
  items: ListItem[];
}

export interface CompareNutrition {
  energy_kcal: string | null;
  sugars: string | null;
  protein: string | null;
  basis: string;
}

export interface CompareProduct {
  card: ProductCardData;
  brand: string | null;
  /** Net content, e.g. "500 g". */
  size: string | null;
  origin: string | null;
  /** Display label: "Ambient" | "Chilled" | "Frozen". */
  storage: string;
  /** Verified claims only. */
  claims: string[];
  nutrition_per_100: CompareNutrition | null;
}

/** `GET /compare/?ids=1,2,3` */
export interface CompareResponse {
  products: CompareProduct[];
  unit_price_comparable: boolean;
  best_value_id: number | null;
  warnings: string[];
}

export type { Money };

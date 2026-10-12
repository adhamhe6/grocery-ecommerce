// Shapes returned by the Orchard Row API (see backend serializers). Money and quantities are always strings.

export type Money = string;

export interface StoreConfig {
  name: string;
  tagline: string;
  logo: string | null;
  brand: { primary: string; accent: string };
  contact: { email: string; phone: string; hours: string; address: string };
  currency: string;
  locale: string;
  timezone: string;
  prices_include_tax: boolean;
  tax_label: string;
  policies: { weight_tolerance_percent: string; substitution_price_cap: boolean; complaint_window_hours: number; min_order_value: Money };
  allow_guest_checkout: boolean;
  payment: { card_enabled: boolean; cod_enabled: boolean; mode: "demo" | "stripe" | "unconfigured" | string };
  demo_mode: boolean;
  socials: { instagram: string; facebook: string; x: string; youtube: string; tiktok: string };
  socials_are_placeholders: boolean;
}

export interface Paginated<T> {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ImageSet {
  alt: string;
  urls: Record<string, string>; // "original" | "320" | "640" | "1024"
}

export interface PromotionTag {
  id: number;
  label: string;
  kind: "PERCENT_OFF" | "AMOUNT_OFF" | "MULTIBUY";
  params: Record<string, unknown>;
}

export interface ProductCardData {
  id: number;
  sku: string;
  slug: string;
  name: string;
  short_description: string;
  brand: { name: string; slug: string } | null;
  category: { id: number; name: string; slug: string; parent_slug: string | null };
  image: ImageSet | null;
  price: Money;
  base_price: Money;
  promotion: PromotionTag | null;
  sale_unit: { code: string; symbol: string; name: string; kind: "COUNT" | "WEIGHT" | "VOLUME" };
  pack_label: string;
  unit_price: { amount: Money; per: string } | null;
  quantity: { min: string; step: string; max: string | null };
  is_variable_weight: boolean;
  product_type: string;
  storage_type: "AMBIENT" | "CHILLED" | "FROZEN";
  availability: { status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "UNAVAILABLE"; max_orderable: string | null; can_order: boolean };
  badges: string[];
  rating: { avg: string; count: number; is_demo: boolean } | null;
}

export interface NutritionData {
  basis: string;
  source: string;
  is_demo: boolean;
  values: Partial<Record<"energy_kcal" | "energy_kj" | "fat" | "saturates" | "carbohydrate" | "sugars" | "fibre" | "protein" | "salt", string>>;
}

export interface ProductDetailData extends ProductCardData {
  description: string;
  images: ImageSet[];
  origin: { country: string; note: string } | null;
  storage_instructions: string;
  ingredients: string;
  packaging: string;
  manufacturer: string;
  allergens: { contains: string[]; may_contain: string[]; confirmed: boolean };
  claims: { kind: string; label: string; evidence: string }[];
  nutrition: NutritionData | null;
  unknowns: ("origin" | "nutrition" | "ingredients" | "allergens" | "storage")[];
  is_perishable: boolean;
  breadcrumbs: { name: string; slug: string }[];
  is_demo: boolean;
  related: ProductCardData[];
}

export interface CategoryNode {
  id: number;
  name: string;
  slug: string;
  description: string;
  image: Record<string, string>;
  count: number;
  show_on_home?: boolean;
  children?: CategoryNode[];
}

export interface Facets {
  brands: { slug: string; name: string; count: number }[];
  categories: { slug: string; name: string; parent: string | null; count: number }[];
  price: { min: Money; max: Money };
}

export interface ProductListResponse extends Paginated<ProductCardData> {
  facets?: Facets;
}

export interface CartIssue {
  code: "UNAVAILABLE" | "OUT_OF_STOCK" | "REDUCED_AVAILABILITY" | "INVALID_QUANTITY" | "PRICE_CHANGED";
  blocking: boolean;
  message: string;
  max_orderable?: string;
  from?: Money;
  to?: Money;
}

export interface CartLine {
  product: ProductCardData;
  quantity: string;
  unit_price: Money;
  base_unit_price: Money;
  line_total: Money;
  promotion: { label: string; kind: string; savings: Money } | null;
  substitution_pref: "INHERIT" | "ALLOW" | "NONE";
  is_estimate: boolean;
  issues: CartIssue[];
}

export type SubstitutionPolicy = "ALLOW" | "CONTACT" | "NONE";

export interface CartData {
  item_count: number;
  substitution_policy: SubstitutionPolicy;
  branch_id: number | null;
  lines: CartLine[];
  coupon: { code: string; valid: boolean; description?: string; discount?: Money; free_delivery?: boolean; message?: string } | null;
  totals: { subtotal: Money; promo_savings: Money; coupon_discount: Money; estimated_total: Money; has_estimated_lines: boolean };
  notices: string[];
  can_checkout: boolean;
  reorder?: { added: { name: string; quantity: string }[]; adjusted: { name: string; requested: string; added: string; reason: string }[]; skipped: { name: string; reason: string }[] };
  list_result?: { added: string[]; skipped: { name: string; reason: string }[] };
}

export interface User {
  id: number;
  email: string;
  full_name: string;
  phone: string;
  role: string;
  is_staff_user: boolean;
  capabilities: string[];
  branch_ids: number[] | null;
  marketing_opt_in: boolean;
  notify_order_emails: boolean;
}

export interface Address {
  id: number;
  label: string;
  recipient_name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  area: string;
  postal_code: string;
  instructions: string;
  is_default: boolean;
}

export interface Branch {
  id: number;
  code: string;
  name: string;
  slug: string;
  address: string;
  phone: string;
  email: string;
  offers_delivery: boolean;
  offers_pickup: boolean;
  pickup_instructions: string;
  prep_minutes: number;
  is_default: boolean;
  hours: { weekday: number; opens: string | null; closes: string | null; is_closed: boolean }[];
}

export interface SlotDay {
  date: string;
  slots: { id: number; kind: string; date: string; start_time: string; end_time: string; fee: Money; remaining: number; scarce: boolean }[];
}

export interface SlotsResponse {
  branch: { id: number; name: string };
  zone: { id: number; name: string; delivery_fee: Money; free_delivery_threshold: Money | null; min_order_value: Money } | null;
  days: SlotDay[];
}

export interface QuoteData {
  currency: string;
  lines: { product_id: number; name: string; quantity: string; unit: string; unit_price: Money; line_total: Money; is_estimate: boolean; promotion: string | null }[];
  subtotal: Money;
  promo_savings: Money;
  coupon: { code: string; discount: Money; description: string } | null;
  delivery_fee: Money;
  delivery_fee_before_free: Money;
  free_delivery: boolean;
  tax_included: Money | null;
  tax_added: Money | null;
  total: Money;
  max_charge: Money;
  weight_buffer: Money;
  has_weighed_items: boolean;
  slot: { id: number; date: string; start: string; end: string; kind: string };
  weight_policy: { tolerance_percent: string };
}

export interface OrderItem {
  id: number;
  product_id: number;
  name: string;
  sku: string;
  image: string | null;
  unit: string;
  ordered_qty: string;
  picked_qty: string | null;
  unit_price: Money;
  base_unit_price: Money;
  promo_label: string;
  line_total_estimated: Money;
  line_total_final: Money | null;
  status: string;
  is_variable_weight: boolean;
  is_substitute: boolean;
  substitute_for: number | null;
  picker_note: string;
  substitution_pref: string;
  price_note: string;
}

export interface OrderPayment {
  state: string;
  method: string;
  mode: "demo" | "stripe" | "cod" | string;
  is_demo: boolean;
  attempt: number;
  amount_authorised: Money;
  amount_captured: Money;
  amount_refunded: Money;
  checkout_url: string;
  can_retry: boolean;
  failure_message: string;
  expires_at: string | null;
}

export interface OrderDetail {
  number: string;
  status: string;
  status_label: string;
  status_summary: string;
  is_terminal: boolean;
  placed_at: string;
  payment_status: string;
  payment_method: string;
  fulfilment_type: "DELIVERY" | "PICKUP";
  currency: string;
  is_demo: boolean;
  branch: { id: number; name: string; address: string; phone: string; pickup_instructions: string };
  slot: { starts_at: string; ends_at: string } | null;
  address: { recipient: string; phone: string; line1: string; line2: string; city: string; area: string; postal_code: string; instructions: string } | null;
  contact: { name: string; email: string; phone: string };
  substitution_policy: SubstitutionPolicy;
  customer_note: string;
  items: OrderItem[];
  totals: {
    subtotal: Money; promo_savings: Money; coupon_code: string; coupon_discount: Money; delivery_fee: Money; tax_total: Money; tax_included: boolean;
    total: Money; max_charge: Money; final_total: Money | null; amount_due: Money; difference: Money | null;
  };
  timeline: { status: string; label: string; at: string }[];
  payment: OrderPayment | null;
  refunds: { amount: Money; status: string; reason: string; requested_at: string; completed_at: string | null; note: string }[];
  pending_substitutions: { id: number; item_id: number; original: string; substitute: string; quantity: string; unit: string; charged_unit_price: Money; list_unit_price: Money; original_unit_price: Money; reason: string; price_note: string }[];
  can_cancel: boolean;
  can_report_problem: boolean;
  cases: { id: number; kind: string; status: string; resolution: string; created_at: string }[];
  tracking_token?: string;
  payment_init_failed?: boolean;
  replayed?: boolean;
}

export interface OrderSummary {
  number: string;
  status: string;
  status_label: string;
  placed_at: string;
  fulfilment_type: string;
  total: Money;
  currency: string;
  item_count: number | null;
  slot_starts_at: string | null;
  payment_status: string;
}

export interface Article {
  slug: string;
  kind: "RECIPE" | "GUIDE";
  title: string;
  summary: string;
  image: string | null;
  body?: string;
  servings?: number | null;
  total_minutes?: number | null;
  products?: ProductCardData[];
  published_at?: string;
}

export interface HomeData {
  banners: { id: number; placement: "HERO" | "STRIP" | "PROMO"; title: string; subtitle: string; cta_label: string; cta_link: string; image: string | null }[];
  departments: CategoryNode[];
  collections: { slug: string; name: string; description: string; products: ProductCardData[] }[];
  offers: ProductCardData[];
  bestsellers: ProductCardData[];
  new_arrivals: ProductCardData[];
  guides: Article[];
}

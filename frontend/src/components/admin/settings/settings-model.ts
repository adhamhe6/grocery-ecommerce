// Pure helpers for the store settings form: API shape, form state, change detection and the PATCH body.

export interface StoreSettingsData {
  name: string; legal_name: string; tagline: string; logo: string | null; brand_primary: string; brand_accent: string;
  support_email: string; support_phone: string; support_hours: string; address: string;
  currency: string; locale: string; timezone: string; prices_include_tax: boolean; tax_label: string;
  weight_tolerance_percent: string; substitution_price_cap: boolean; complaint_window_hours: number; min_order_value: string;
  allow_guest_checkout: boolean; card_payments_enabled: boolean; cash_on_delivery_enabled: boolean; demo_mode: boolean;
  instagram_url: string; facebook_url: string; x_url: string; youtube_url: string; tiktok_url: string;
  socials_are_placeholders: boolean; updated_at: string;
}

export const SOCIAL_FIELDS = [
  ["instagram_url", "Instagram"], ["facebook_url", "Facebook"], ["x_url", "X"], ["youtube_url", "YouTube"], ["tiktok_url", "TikTok"],
] as const;

export interface SettingsForm {
  name: string; legal_name: string; tagline: string; brand_primary: string; brand_accent: string;
  support_email: string; support_phone: string; support_hours: string; address: string;
  currency: string; locale: string; timezone: string; prices_include_tax: boolean; tax_label: string;
  weight_tolerance_percent: string; substitution_price_cap: boolean; complaint_window_hours: string; min_order_value: string;
  allow_guest_checkout: boolean; card_payments_enabled: boolean; cash_on_delivery_enabled: boolean; demo_mode: boolean;
  instagram_url: string; facebook_url: string; x_url: string; youtube_url: string; tiktok_url: string;
  socials_are_placeholders: boolean;
}
export type SettingsKey = keyof SettingsForm;

/** Every field the form edits, i.e. every key of StoreSettingsData except `logo` (own endpoint) and `updated_at`. */
export const SETTINGS_FIELDS: SettingsKey[] = [
  "name", "legal_name", "tagline", "brand_primary", "brand_accent", "support_email", "support_phone", "support_hours", "address",
  "currency", "locale", "timezone", "prices_include_tax", "tax_label", "weight_tolerance_percent", "substitution_price_cap",
  "complaint_window_hours", "min_order_value", "allow_guest_checkout", "card_payments_enabled", "cash_on_delivery_enabled", "demo_mode",
  "instagram_url", "facebook_url", "x_url", "youtube_url", "tiktok_url", "socials_are_placeholders",
];
const DECIMAL_KEYS: SettingsKey[] = ["weight_tolerance_percent", "min_order_value"];

export function formFromSettings(s: StoreSettingsData): SettingsForm {
  const { logo: _logo, updated_at: _updated, ...rest } = s;
  void _logo; void _updated;
  return { ...rest, complaint_window_hours: String(s.complaint_window_hours) };
}

const sameNumber = (a: string, b: string) => a.trim() !== "" && b.trim() !== "" && Number(a) === Number(b);

/** Normalises what the API stores: currency upper-case, colours upper-case hex, text trimmed. */
function normalise(key: SettingsKey, value: string | boolean): string | boolean {
  if (typeof value === "boolean") return value;
  const v = value.trim();
  if (key === "currency") return v.toUpperCase();
  if (key === "brand_primary" || key === "brand_accent") return v.toUpperCase();
  return v;
}

/** Fields whose value differs from the loaded settings. Numeric text that means the same number ("10" vs "10.00") is not a change. */
export function changedKeys(initial: SettingsForm, current: SettingsForm): SettingsKey[] {
  return (Object.keys(initial) as SettingsKey[]).filter((key) => {
    const a = initial[key], b = current[key];
    if (typeof a === "boolean" || typeof b === "boolean") return a !== b;
    if ((DECIMAL_KEYS.includes(key) || key === "complaint_window_hours") && sameNumber(a, b)) return false;
    return normalise(key, a) !== normalise(key, b);
  });
}

/** Body of PATCH /settings/: only what changed, with each value in the form the API expects. */
export function buildSettingsPatch(initial: SettingsForm, current: SettingsForm): Record<string, string | number | boolean> {
  const patch: Record<string, string | number | boolean> = {};
  for (const key of changedKeys(initial, current)) {
    const value = normalise(key, current[key]);
    if (key === "complaint_window_hours" && typeof value === "string" && /^\d+$/.test(value)) patch[key] = Number(value);
    else patch[key] = value;
  }
  return patch;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only the obvious problems; everything else (ranges, formats) is checked by the server and shown against its field. */
export function validateSettings(f: SettingsForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = "Enter the store name.";
  if (!f.tagline.trim()) e.tagline = "Enter a short tagline.";
  if (!f.support_email.trim()) e.support_email = "Enter a contact email address.";
  else if (!EMAIL.test(f.support_email.trim())) e.support_email = "That doesn't look like an email address.";
  if (!HEX.test(f.brand_primary.trim())) e.brand_primary = "Use a 6-digit hex colour such as #1F3D2B.";
  if (!HEX.test(f.brand_accent.trim())) e.brand_accent = "Use a 6-digit hex colour such as #B8532F.";
  if (!/^[A-Za-z]{3}$/.test(f.currency.trim())) e.currency = "Use a 3-letter currency code such as USD or EUR.";
  if (!f.locale.trim()) e.locale = "Enter a language tag such as en-US.";
  if (!f.timezone.trim()) e.timezone = "Enter a time zone such as Europe/London.";
  if (!f.tax_label.trim()) e.tax_label = "Enter the tax name, for example VAT.";
  if (!f.card_payments_enabled && !f.cash_on_delivery_enabled) e.card_payments_enabled = "Keep at least one payment method switched on, or nobody can check out.";
  for (const [key, label] of SOCIAL_FIELDS) {
    const url = f[key].trim();
    if (url && !url.toLowerCase().startsWith("https://")) e[key] = `${label} links must start with https://`;
  }
  return e;
}

/** A sample amount in the chosen currency/locale, or null while either is not (yet) a valid code. */
export function currencyPreview(currency: string, locale: string, amount = 1234.5): string | null {
  if (!/^[A-Za-z]{3}$/.test(currency.trim())) return null;
  try {
    return new Intl.NumberFormat(locale.trim() || "en-US", { style: "currency", currency: currency.trim().toUpperCase() }).format(amount);
  } catch {
    return null;
  }
}

export interface ProviderInfo { tone: "ok" | "info" | "warn"; label: string; text: string }

/** What the (read-only) payment provider mode means, using only facts the code establishes. */
export function providerInfo(mode: string): ProviderInfo {
  if (mode === "demo") return { tone: "warn", label: "Demo sandbox", text: "Card payments go through the demo sandbox. It never moves money: customers pick succeed or fail on a test page, and refunds are simulated." };
  if (mode === "stripe") return { tone: "ok", label: "Stripe", text: "Card payments are taken through Stripe." };
  if (mode === "unconfigured") return { tone: "warn", label: "Not configured", text: "No card payment provider is set up on the server, so card payments are unavailable whatever the switch below says." };
  return { tone: "info", label: mode || "Unknown", text: "The server reports an unrecognised payment provider mode." };
}

/** Socials render in the storefront footer only when the placeholder flag is off and a URL is set. */
export function visibleSocialCount(f: Pick<SettingsForm, "socials_are_placeholders" | "instagram_url" | "facebook_url" | "x_url" | "youtube_url" | "tiktok_url">): number {
  if (f.socials_are_placeholders) return 0;
  return SOCIAL_FIELDS.filter(([k]) => f[k].trim()).length;
}

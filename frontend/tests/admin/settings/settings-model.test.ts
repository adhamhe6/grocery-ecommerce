import { describe, expect, it } from "vitest";
import {
  buildSettingsPatch, changedKeys, currencyPreview, formFromSettings, providerInfo, SETTINGS_FIELDS, validateSettings, visibleSocialCount, type StoreSettingsData,
} from "@/components/admin/settings/settings-model";

const data: StoreSettingsData = {
  name: "Orchard Row", legal_name: "", tagline: "Fresh, honestly labelled.", logo: null, brand_primary: "#1F3D2B", brand_accent: "#B8532F",
  support_email: "hello@example.com", support_phone: "", support_hours: "", address: "", currency: "USD", locale: "en-US", timezone: "UTC",
  prices_include_tax: true, tax_label: "VAT", weight_tolerance_percent: "10.00", substitution_price_cap: true, complaint_window_hours: 24, min_order_value: "0.00",
  allow_guest_checkout: true, card_payments_enabled: true, cash_on_delivery_enabled: true, demo_mode: false,
  instagram_url: "https://instagram.com/x", facebook_url: "", x_url: "", youtube_url: "", tiktok_url: "", socials_are_placeholders: true, updated_at: "2026-01-01T00:00:00Z",
};
const initial = formFromSettings(data);

describe("form <-> API", () => {
  it("covers exactly the editable fields (everything but logo and updated_at)", () => {
    expect([...SETTINGS_FIELDS].sort()).toEqual(Object.keys(initial).sort());
    expect(Object.keys(data).filter((k) => !["logo", "updated_at"].includes(k)).sort()).toEqual([...SETTINGS_FIELDS].sort());
  });
  it("turns the hours number into text for the input", () => {
    expect(initial.complaint_window_hours).toBe("24");
  });
});

describe("buildSettingsPatch", () => {
  it("is empty when nothing changed, including numerically-equal text and different case", () => {
    expect(buildSettingsPatch(initial, { ...initial, weight_tolerance_percent: "10", min_order_value: "0", currency: "usd", brand_primary: "#1f3d2b" })).toEqual({});
  });
  it("sends only changed fields, normalised the way the API stores them", () => {
    const patch = buildSettingsPatch(initial, {
      ...initial, name: "  Fresh Co ", currency: "eur", brand_accent: "#0a3d2b", weight_tolerance_percent: "7.5", complaint_window_hours: "48",
      card_payments_enabled: false, socials_are_placeholders: false,
    });
    expect(patch).toEqual({ name: "Fresh Co", currency: "EUR", brand_accent: "#0A3D2B", weight_tolerance_percent: "7.5", complaint_window_hours: 48, card_payments_enabled: false, socials_are_placeholders: false });
  });
  it("lets a social link be blanked and sends the change", () => {
    expect(buildSettingsPatch(initial, { ...initial, instagram_url: "" })).toEqual({ instagram_url: "" });
  });
  it("keeps unparseable numbers as text so the server can explain the problem", () => {
    expect(buildSettingsPatch(initial, { ...initial, complaint_window_hours: "abc" })).toEqual({ complaint_window_hours: "abc" });
  });
  it("reports which keys changed", () => {
    expect(changedKeys(initial, { ...initial, demo_mode: true, tagline: "New" }).sort()).toEqual(["demo_mode", "tagline"]);
  });
});

describe("validateSettings", () => {
  it("passes the seeded settings", () => {
    expect(validateSettings(initial)).toEqual({});
  });
  it("flags empty required fields, bad colours and an unusable payment setup", () => {
    const errors = validateSettings({ ...initial, name: " ", support_email: "nope", brand_primary: "red", currency: "US", card_payments_enabled: false, cash_on_delivery_enabled: false });
    expect(Object.keys(errors).sort()).toEqual(["brand_primary", "card_payments_enabled", "currency", "name", "support_email"]);
  });
  it("requires social links to be https, but allows blank", () => {
    expect(validateSettings({ ...initial, facebook_url: "http://facebook.com/x" }).facebook_url).toMatch(/https/);
    expect(validateSettings({ ...initial, facebook_url: "" })).toEqual({});
  });
});

describe("currencyPreview", () => {
  it("shows a sample amount in the chosen currency and locale", () => {
    expect(currencyPreview("USD", "en-US")).toBe("$1,234.50");
    expect(currencyPreview("eur", "de-DE")).toMatch(/1\.234,50\s*€/);
  });
  it("is null until the code is a plausible currency", () => {
    expect(currencyPreview("US", "en-US")).toBeNull();
    expect(currencyPreview("", "en-US")).toBeNull();
  });
});

describe("payment provider mode and social visibility", () => {
  it("describes demo, stripe and unconfigured honestly", () => {
    expect(providerInfo("demo")).toMatchObject({ label: "Demo sandbox" });
    expect(providerInfo("demo").text).toMatch(/never moves money/);
    expect(providerInfo("stripe").label).toBe("Stripe");
    expect(providerInfo("unconfigured").text).toMatch(/unavailable/);
    expect(providerInfo("mystery").label).toBe("mystery");
  });
  it("hides every social link while they are marked as placeholders", () => {
    expect(visibleSocialCount({ ...initial })).toBe(0);
    expect(visibleSocialCount({ ...initial, socials_are_placeholders: false })).toBe(1);
    expect(visibleSocialCount({ ...initial, socials_are_placeholders: false, instagram_url: "" })).toBe(0);
  });
});

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsFormView } from "@/components/admin/settings/settings-form";
import type { StoreSettingsData } from "@/components/admin/settings/settings-model";
import { apiError, mockApi, renderAdmin } from "../finance/helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());

const data: StoreSettingsData = {
  name: "Orchard Row", legal_name: "", tagline: "Fresh, honestly labelled.", logo: null, brand_primary: "#1F3D2B", brand_accent: "#B8532F",
  support_email: "hello@example.com", support_phone: "", support_hours: "", address: "", currency: "USD", locale: "en-US", timezone: "UTC",
  prices_include_tax: true, tax_label: "VAT", weight_tolerance_percent: "10.00", substitution_price_cap: true, complaint_window_hours: 24, min_order_value: "0.00",
  allow_guest_checkout: true, card_payments_enabled: true, cash_on_delivery_enabled: true, demo_mode: false,
  instagram_url: "https://instagram.com/x", facebook_url: "", x_url: "", youtube_url: "", tiktok_url: "", socials_are_placeholders: true, updated_at: "2026-10-01T10:00:00Z",
};

describe("SettingsFormView", () => {
  it("starts clean, shows the read-only provider mode and says demo never moves money", () => {
    renderAdmin(<SettingsFormView latest={data} />);
    expect(screen.getByRole("button", { name: /save settings/i })).toBeDisabled();
    expect(screen.getByText("Card payment provider")).toBeInTheDocument();
    expect(screen.getByText(/demo mode never moves money/i)).toBeInTheDocument();
    expect(screen.getByText(/no unsaved changes/i)).toBeInTheDocument();
  });

  it("checks brand colour contrast against white text live, with the 4.5:1 rule", async () => {
    renderAdmin(<SettingsFormView latest={data} />);
    expect(screen.getAllByText(/passes WCAG AA/i).length).toBeGreaterThanOrEqual(1);
    const primary = screen.getByRole("textbox", { name: /primary colour/i });
    fireEvent.change(primary, { target: { value: "#E3A72F" } });
    const failing = await screen.findByText(/fails WCAG AA/i);
    expect(failing).toHaveTextContent(/white text on this colour: 2\.\d\d:1/i);
    expect(failing).toHaveTextContent(/needs 4\.5:1/i);
    expect(screen.getAllByText(/passes WCAG AA/i)).toHaveLength(1); // the accent colour is still fine
  });

  it("sends only the fields that changed", async () => {
    const api = mockApi({ "PATCH /admin/settings/": ({ body }) => ({ json: { ...data, ...body, updated_at: "2026-10-01T10:05:00Z" } }) });
    const user = userEvent.setup();
    renderAdmin(<SettingsFormView latest={data} />);
    const tolerance = screen.getByLabelText(/weight tolerance/i);
    await user.clear(tolerance);
    await user.type(tolerance, "7.5");
    expect(screen.getByText(/1 unsaved change/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    await waitFor(() => expect(api.of("PATCH /admin/settings/")).toHaveLength(1));
    expect(api.of("PATCH /admin/settings/")[0].body).toEqual({ weight_tolerance_percent: "7.5" });
    expect(await screen.findByText(/no unsaved changes/i)).toBeInTheDocument();
  });

  it("shows the risk line under the tolerance field", () => {
    renderAdmin(<SettingsFormView latest={data} />);
    expect(screen.getByText(/pickers may pick up to this much over the ordered weight/i)).toBeInTheDocument();
  });

  it("maps a server validation error to its field", async () => {
    mockApi({ "PATCH /admin/settings/": apiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { weight_tolerance_percent: ["The tolerance must be between 0 and 50 percent."] }) });
    const user = userEvent.setup();
    renderAdmin(<SettingsFormView latest={data} />);
    const tolerance = screen.getByLabelText(/weight tolerance/i);
    await user.clear(tolerance);
    await user.type(tolerance, "80");
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    const message = await screen.findByText("The tolerance must be between 0 and 50 percent.");
    expect(tolerance).toHaveAttribute("aria-invalid", "true");
    expect(tolerance.getAttribute("aria-describedby")).toBe(message.id);
    expect(tolerance).toHaveValue("80");
  });

  it("won't let both payment methods be switched off", async () => {
    const api = mockApi({});
    const user = userEvent.setup();
    renderAdmin(<SettingsFormView latest={data} />);
    await user.click(screen.getByLabelText(/accept card payments/i));
    await user.click(screen.getByLabelText(/accept cash on delivery/i));
    await user.click(screen.getByRole("button", { name: /save settings/i }));
    expect(await screen.findByText(/keep at least one payment method switched on/i)).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("flags placeholder social links as hidden on the storefront until the box is unticked", async () => {
    const user = userEvent.setup();
    renderAdmin(<SettingsFormView latest={data} />);
    expect(screen.getByText(/the footer currently hides every social link/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/these social links are placeholders/i));
    expect(screen.getByText(/the footer will show 1 social link/i)).toBeInTheDocument();
  });
});

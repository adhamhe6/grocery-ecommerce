import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterForm } from "@/components/account/register-form";
import { ResetPasswordForm } from "@/components/account/reset-password-form";
import { apiError, mockApi, renderWithProviders, user as me } from "./helpers";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/register",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => replace.mockClear());
afterEach(() => vi.unstubAllGlobals());

const anonymous = { "GET /auth/session/": { json: { user: null } } };

async function fillRegister(over: { name?: string; email?: string; password?: string } = {}) {
  await userEvent.type(await screen.findByLabelText(/Full name/), over.name ?? "Ada Lovelace");
  await userEvent.type(screen.getByLabelText(/Email address/), over.email ?? "ada@example.com");
  await userEvent.type(screen.getByLabelText(/^Password/), over.password ?? "correct horse battery");
}

describe("RegisterForm", () => {
  it("has the right autocomplete hints and an unticked marketing box", async () => {
    mockApi(anonymous);
    renderWithProviders(<RegisterForm next="/account" />);
    expect(await screen.findByLabelText(/Full name/)).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText(/Email address/)).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText(/Phone number/)).toHaveAttribute("autocomplete", "tel");
    expect(screen.getByRole("checkbox", { name: /news and offers/i })).not.toBeChecked();
  });

  it("states the password rules and enforces the length before calling the API", async () => {
    const api = mockApi(anonymous);
    renderWithProviders(<RegisterForm next="/account" />);
    expect(await screen.findByText(/Use at least 10 characters/)).toBeInTheDocument();
    await fillRegister({ password: "short" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Use at least 10 characters.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.key === "POST /auth/register/")).toBe(false);
  });

  it("puts 'email already exists' on the email field", async () => {
    mockApi({ ...anonymous, "POST /auth/register/": apiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { email: ["An account with this email already exists. Try signing in instead."] }) });
    renderWithProviders(<RegisterForm next="/account" />);
    await fillRegister();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByText("An account with this email already exists. Try signing in instead.");
    expect(screen.getByLabelText(/Email address/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Email address/)).toHaveAccessibleDescription(/already exists/);
  });

  it("puts password-rule failures (a non-field error) on the password field", async () => {
    mockApi({ ...anonymous, "POST /auth/register/": apiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", { non_field_errors: ["This password is too common."] }) });
    renderWithProviders(<RegisterForm next="/account" />);
    await fillRegister({ password: "password12345" });
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByText("This password is too common.");
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("aria-invalid", "true");
  });

  it("sends marketing consent only when the shopper ticks the box", async () => {
    const api = mockApi({ ...anonymous, "POST /auth/register/": { status: 201, json: me }, "GET /cart/": { json: {} } });
    renderWithProviders(<RegisterForm next="/account" />);
    await fillRegister();
    await userEvent.type(screen.getByLabelText(/Phone number/), "555 010 2030");
    await userEvent.click(screen.getByRole("checkbox", { name: /news and offers/i }));
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(api.calls.some((c) => c.key === "POST /auth/register/")).toBe(true));
    expect(api.calls.find((c) => c.key === "POST /auth/register/")?.body).toMatchObject({ marketing_opt_in: true, phone: "555 010 2030" });
  });

  it("sends only what was filled in, then continues to the destination", async () => {
    const api = mockApi({ ...anonymous, "POST /auth/register/": { status: 201, json: me }, "GET /cart/": { json: {} } });
    renderWithProviders(<RegisterForm next="/checkout" />);
    await fillRegister();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/checkout"));
    expect(api.calls.find((c) => c.key === "POST /auth/register/")?.body).toEqual({ email: "ada@example.com", password: "correct horse battery", full_name: "Ada Lovelace", marketing_opt_in: false });
  });
});

describe("ResetPasswordForm", () => {
  const fill = async (password = "a brand new password", confirm = password) => {
    await userEvent.type(await screen.findByLabelText(/^New password/), password);
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), confirm);
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
  };

  it("explains a link with no uid/token instead of showing a dead form", () => {
    renderWithProviders(<ResetPasswordForm uid={null} token={null} />);
    expect(screen.getByRole("heading", { name: "This link can't be used" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Email me a new link" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  });

  it("checks both passwords match before calling the API", async () => {
    const api = mockApi({});
    renderWithProviders(<ResetPasswordForm uid="MQ" token="abc-123" />);
    await fill("a brand new password", "a different password");
    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("posts uid, token and the new password, then offers sign-in", async () => {
    const api = mockApi({ "POST /auth/password-reset/confirm/": { status: 204 } });
    renderWithProviders(<ResetPasswordForm uid="MQ" token="abc-123" />);
    await fill();
    expect(await screen.findByRole("heading", { name: "Password changed" })).toBeInTheDocument();
    expect(api.calls[0]).toEqual({ key: "POST /auth/password-reset/confirm/", body: { uid: "MQ", token: "abc-123", new_password: "a brand new password" } });
    expect(screen.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
  });

  it("shows server password-rule messages (a bare array) on the password field", async () => {
    mockApi({ "POST /auth/password-reset/confirm/": apiError(400, "VALIDATION_ERROR", "Please correct the highlighted fields.", ["This password is too common."]) });
    renderWithProviders(<ResetPasswordForm uid="MQ" token="abc-123" />);
    await fill("password1234567");
    await screen.findByText("This password is too common.");
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute("aria-invalid", "true");
  });

  it("switches to the expired-link state when the API says the link is dead", async () => {
    mockApi({ "POST /auth/password-reset/confirm/": apiError(400, "INVALID_RESET_LINK", "This reset link is invalid or has expired. Please request a new one.") });
    renderWithProviders(<ResetPasswordForm uid="MQ" token="old" />);
    await fill();
    expect(await screen.findByText("This reset link is invalid or has expired. Please request a new one.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Email me a new link" })).toBeInTheDocument();
  });
});

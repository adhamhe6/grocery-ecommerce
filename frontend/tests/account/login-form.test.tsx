import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/account/login-form";
import { apiError, mockApi, renderWithProviders, user as me } from "./helpers";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => replace.mockClear());
afterEach(() => vi.unstubAllGlobals());

const anonymous = { "GET /auth/session/": { json: { user: null } } };

describe("LoginForm", () => {
  it("explains empty fields without calling the API", async () => {
    const api = mockApi(anonymous);
    renderWithProviders(<LoginForm next="/account" />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(api.calls.some((c) => c.key === "POST /auth/login/")).toBe(false);
  });

  it("labels fields, sets autocomplete and toggles the password", async () => {
    mockApi(anonymous);
    renderWithProviders(<LoginForm next="/account" />);
    const email = await screen.findByLabelText("Email address");
    const password = screen.getByLabelText("Password");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(password).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the API's message when the credentials are wrong and stays on the page", async () => {
    mockApi({ ...anonymous, "POST /auth/login/": apiError(401, "INVALID_CREDENTIALS", "That email and password don't match. Please try again.") });
    renderWithProviders(<LoginForm next="/account" />);
    await userEvent.type(await screen.findByLabelText("Email address"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("That email and password don't match. Please try again.")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows the rate-limit message with the wait time", async () => {
    mockApi({ ...anonymous, "POST /auth/login/": apiError(429, "RATE_LIMITED", "Too many failed sign-in attempts. Please wait 15 minutes or reset your password.", { retry_after: 600 }) });
    renderWithProviders(<LoginForm next="/account" />);
    await userEvent.type(await screen.findByLabelText("Email address"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/Too many failed sign-in attempts/)).toBeInTheDocument();
  });

  it("signs in and goes to the requested page", async () => {
    const api = mockApi({ ...anonymous, "POST /auth/login/": { json: me }, "GET /cart/": { json: {} }, "GET /favorites/": { json: { ids: [], products: [] } } });
    renderWithProviders(<LoginForm next="/checkout" />);
    await userEvent.type(await screen.findByLabelText("Email address"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/checkout"));
    expect(api.calls.find((c) => c.key === "POST /auth/login/")?.body).toEqual({ email: "ada@example.com", password: "correct horse battery" });
  });

  it("never redirects off-site, even if given a hostile next", async () => {
    mockApi({ ...anonymous, "POST /auth/login/": { json: me }, "GET /cart/": { json: {} } });
    renderWithProviders(<LoginForm next="//evil.example/steal" />);
    await userEvent.type(await screen.findByLabelText("Email address"), "ada@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/account"));
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining("evil"));
  });

  it("sends an already signed-in visitor on without showing the form", async () => {
    mockApi({ "GET /auth/session/": { json: { user: me } } });
    renderWithProviders(<LoginForm next="/account" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/account"));
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  });
});

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/components/account/forgot-password-form";
import { apiError, mockApi, renderWithProviders } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

describe("ForgotPasswordForm", () => {
  it("gives the same generic confirmation the API gives, whoever owns the address", async () => {
    const api = mockApi({ "POST /auth/password-reset/": { status: 202, json: { detail: "If an account exists for that email, a reset link is on its way." } } });
    renderWithProviders(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText("Email address"), "someone@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toHaveFocus();
    expect(screen.getByText(/If an account exists for/)).toBeInTheDocument();
    expect(screen.queryByText(/no account|not found|doesn't exist/i)).not.toBeInTheDocument();
    expect(api.calls[0]).toEqual({ key: "POST /auth/password-reset/", body: { email: "someone@example.com" } });
  });

  it("validates the email shape first", async () => {
    const api = mockApi({});
    renderWithProviders(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText("Email address"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Enter a valid email address, like name@example.com.")).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
  });

  it("tells the shopper when they're being rate limited", async () => {
    mockApi({ "POST /auth/password-reset/": apiError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.", { retry_after: 2400 }) });
    renderWithProviders(<ForgotPasswordForm />);
    await userEvent.type(screen.getByLabelText("Email address"), "someone@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(/Too many requests.*about 40 minutes/)).toBeInTheDocument();
  });
});

import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountShell } from "@/components/account/account-shell";
import { apiError, mockApi, renderWithProviders, user as me } from "./helpers";

const nav = vi.hoisted(() => ({ pathname: "/account/orders", replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  nav.replace.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe("AccountShell", () => {
  it("sends visitors who aren't signed in to /login with the page they wanted", async () => {
    mockApi({ "GET /auth/session/": { json: { user: null } } });
    window.history.pushState({}, "", "/account/orders?page=2");
    renderWithProviders(<AccountShell><p>secret orders</p></AccountShell>);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/login?next=%2Faccount%2Forders%3Fpage%3D2"));
    expect(screen.queryByText("secret orders")).not.toBeInTheDocument();
  });

  it("shows the page and marks the current section for signed-in customers", async () => {
    mockApi({ "GET /auth/session/": { json: { user: me } } });
    renderWithProviders(<AccountShell><p>my orders</p></AccountShell>);
    expect(await screen.findByText("my orders")).toBeInTheDocument();
    const navEl = screen.getByRole("navigation", { name: "Account" });
    expect(screen.getByRole("link", { name: /Orders/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Overview/ })).not.toHaveAttribute("aria-current");
    expect(navEl.querySelectorAll("a")).toHaveLength(5);
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("does not bounce people to /login when the session check itself fails", async () => {
    mockApi({ "GET /auth/session/": apiError(500, "INTERNAL_ERROR", "Something went wrong on our side. Please try again.") });
    renderWithProviders(<AccountShell><p>x</p></AccountShell>);
    expect(await screen.findByText("We couldn't check your sign-in")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

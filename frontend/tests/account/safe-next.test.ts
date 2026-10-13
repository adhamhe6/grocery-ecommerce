import { describe, expect, it } from "vitest";
import { loginHref, safeNextPath, withNext } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it("keeps same-site paths, queries and hashes", () => {
    expect(safeNextPath("/checkout")).toBe("/checkout");
    expect(safeNextPath("/account/orders?page=2")).toBe("/account/orders?page=2");
    expect(safeNextPath("/product/oat-milk#reviews")).toBe("/product/oat-milk#reviews");
    expect(safeNextPath("/shop?q=a%20b&sort=price_asc")).toBe("/shop?q=a%20b&sort=price_asc");
  });

  it("falls back for missing or non-string values", () => {
    expect(safeNextPath(undefined)).toBe("/account");
    expect(safeNextPath(null)).toBe("/account");
    expect(safeNextPath("")).toBe("/account");
    expect(safeNextPath(["/checkout"])).toBe("/account");
    expect(safeNextPath(42)).toBe("/account");
    expect(safeNextPath(undefined, "/")).toBe("/");
  });

  it.each([
    "https://evil.example/phish",
    "http://evil.example",
    "//evil.example",
    "//evil.example/path",
    "/\\evil.example",
    "\\\\evil.example",
    "/\\/evil.example",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "evil.example",
    "checkout",
    " /checkout",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/check\u0000out",
    "/.//evil.example",
    "/%2e%2e//evil.example",
    "/foo/..//evil.example",
    "/foo/%2e%2e/%2e%2e//evil.example",
  ])("rejects %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/account");
  });

  it("never returns something that could leave the site", () => {
    const attempts = ["/a//b", "/.", "/..", "/./", "/%2F%2Fevil.example", "/?next=//evil.example", "/#//evil.example", "/ok\\evil"];
    for (const raw of attempts) {
      const out = safeNextPath(raw, "/fallback");
      const resolved = new URL(out, "https://shop.example");
      expect(resolved.origin).toBe("https://shop.example");
      expect(out.startsWith("//")).toBe(false);
    }
  });

  it("refuses to bounce shoppers between the auth pages", () => {
    for (const p of ["/login", "/login/", "/register", "/forgot-password", "/reset-password", "/account/reset-password?uid=1&token=x"]) {
      expect(safeNextPath(p)).toBe("/account");
    }
  });

  it("refuses API and framework internals", () => {
    expect(safeNextPath("/api/v1/auth/logout/")).toBe("/account");
    expect(safeNextPath("/_next/static/chunk.js")).toBe("/account");
  });

  it("normalises dot segments instead of passing them through", () => {
    expect(safeNextPath("/shop/../cart")).toBe("/cart");
  });

  it("rejects very long values", () => {
    expect(safeNextPath(`/${"a".repeat(3000)}`)).toBe("/account");
  });
});

describe("loginHref / withNext", () => {
  it("encodes the destination", () => {
    expect(loginHref("/account/orders?page=2")).toBe("/login?next=%2Faccount%2Forders%3Fpage%3D2");
  });
  it("drops unsafe destinations", () => {
    expect(loginHref("//evil.example")).toBe("/login");
    expect(loginHref("https://evil.example")).toBe("/login");
  });
  it("only carries next when it isn't the default", () => {
    expect(withNext("/register", "/account")).toBe("/register");
    expect(withNext("/register", "/checkout")).toBe("/register?next=%2Fcheckout");
  });
});

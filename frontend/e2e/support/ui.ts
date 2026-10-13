import { expect, type Page } from "@playwright/test";

export const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? "OrchardDemo-2024!";
export const demoEmail = (local: string) => `${local}@demo.orchardrow.test`;

/** Parses "$1,234.50" / "≈ $3.20" / "−$2.00" to integer cents. */
export const toCents = (text: string) => {
  const m = text.replace(/[,\s]/g, "").match(/(-|−)?\$?(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`No amount in "${text}"`);
  return Math.round(Number(m[2]) * 100) * (m[1] ? -1 : 1);
};

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").first().fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page.getByLabel("Account menu")).toBeVisible();
}

export async function addProductFromPage(page: Page, slug: string, extraSteps = 0) {
  await page.goto(`/product/${slug}`);
  for (let i = 0; i < extraSteps; i++) await page.getByRole("button", { name: /^Increase quantity of/ }).first().click();
  await page.getByRole("button", { name: "Add to basket" }).click();
  await expect(page.getByText("In your basket")).toBeVisible();
}

/** Fills the guest checkout form for a delivery address inside the Old Town zone and picks the first slot. */
export async function fillGuestDelivery(page: Page, email: string, name = "Gina Guest") {
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Mobile number").first().fill("+1 555 0190");
  await page.getByLabel("Email for your order confirmation").fill(email);
  await page.getByLabel("Recipient name").fill(name);
  await page.getByLabel("Phone for this address").fill("+1 555 0190");
  await page.getByLabel("Address line 1").fill("101 Old Town Row");
  await page.getByLabel("Town or city").fill("Riverton");
  await page.getByLabel("Postcode").fill("RW1 1BT");
  const firstSlot = page.getByRole("radio", { name: /–/ }).first();
  await expect(firstSlot).toBeVisible({ timeout: 20_000 });
  await firstSlot.check();
}

export function uniqueEmail(prefix = "e2e") {
  return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
}

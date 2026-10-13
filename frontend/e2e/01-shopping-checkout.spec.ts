import { expect, test } from "@playwright/test";
import { cents, one, orderByNumber, rows, stock } from "./support/db";
import { cancelOpenOrdersFor } from "./support/api";
import { toCents, uniqueEmail } from "./support/ui";

const emails: string[] = [];
test.afterEach(async ({ request }) => cancelOpenOrdersFor(request, ...emails));

/** Workflow 1: browse/search → product → quantity → cart → guest → address → slot → substitutions → review → pay → order. */
test("guest shops, checks out with the demo card sandbox and sees a confirmed order", async ({ page }) => {
  const email = uniqueEmail("guest");
  emails.push(email);
  const milkBefore = await stock("whole-milk");

  // Browse by department and open a product.
  await page.goto("/");
  await page.getByRole("navigation", { name: "Departments" }).getByRole("link", { name: /Chilled & Dairy/ }).first().click();
  await expect(page).toHaveURL(/category=chilled-dairy|category=/);
  await page.getByRole("link", { name: "Whole Milk" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Whole Milk" })).toBeVisible();

  // Choose a quantity of 2 and add to the basket.
  await page.getByRole("button", { name: /^Increase quantity of/ }).first().click();
  await page.getByRole("button", { name: "Add to basket" }).click();
  await expect(page.getByText("In your basket")).toBeVisible();

  // Search for a second product and add it from the results.
  await page.getByRole("combobox").first().fill("eggs");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=eggs/);
  await page.getByRole("button", { name: "Add Large White Eggs to basket" }).click();
  await expect(page.getByRole("group", { name: "Quantity of Large White Eggs" })).toBeVisible();

  // Update the basket: one more milk, then check the arithmetic the shopper sees.
  await page.goto("/cart");
  await page.getByRole("button", { name: "Increase quantity of Whole Milk" }).click();
  await page.getByRole("button", { name: "Increase quantity of Whole Milk" }).click();
  await expect(page.getByRole("group", { name: "Quantity of Whole Milk" })).toContainText("4");
  const subtotalText = await page.getByText(/Subtotal \(2 items\)/).locator("xpath=following-sibling::dd").innerText();
  expect(toCents(subtotalText)).toBe(4 * 399 + 429); // 4 × $3.99 + 1 × $4.29 (no promotion applies to either)
  await page.getByRole("link", { name: /^Checkout/ }).click();

  // Checkout as a guest with a delivery address inside a zone.
  await expect(page.getByRole("heading", { level: 1, name: "Checkout" })).toBeVisible();
  await page.getByLabel("Full name").fill("Gina Guest");
  await page.getByLabel("Mobile number").first().fill("+1 555 0190");
  await page.getByLabel("Email for your order confirmation").fill(email);
  await page.getByLabel("Recipient name").fill("Gina Guest");
  await page.getByLabel("Phone for this address").fill("+1 555 0190");
  await page.getByLabel("Address line 1").fill("101 Old Town Row");
  await page.getByLabel("Town or city").fill("Riverton");
  await page.getByLabel("Postcode").fill("RW1 1BT");

  // Slots appear for the zone; pick the first available one.
  const firstSlot = page.getByRole("radio", { name: /–/ }).first();
  await expect(firstSlot).toBeVisible({ timeout: 20_000 });
  await firstSlot.check();

  // Substitution preference, then review the cost.
  await page.getByRole("radio", { name: /Ask me first/ }).check();
  const summary = page.getByRole("complementary", { name: "Order summary" });
  const deliveryRow = summary.getByText("Delivery", { exact: true }).locator("xpath=following-sibling::dd");
  await expect(deliveryRow).toHaveText("$3.99"); // appears once the server has priced the order with the chosen slot
  const totalText = await summary.getByText("Total", { exact: true }).locator("xpath=following-sibling::dd").innerText();
  expect(toCents(totalText)).toBe(4 * 399 + 429 + 399);

  // Pay with the demo sandbox: the redirect alone must not confirm; the simulated provider event does.
  await page.getByRole("button", { name: /Place order & pay/ }).click();
  await expect(page).toHaveURL(/\/pay\/demo\//);
  await expect(page.getByText(/not a real payment/i)).toBeVisible();
  const before = await rows("SELECT status FROM orders_order WHERE contact_email = $1", [email]);
  expect(before).toHaveLength(1);
  expect(before[0].status).toBe("PENDING_PAYMENT");
  await page.getByRole("button", { name: "Simulate a successful payment" }).click();

  // The customer sees the confirmed order.
  await expect(page).toHaveURL(/\/orders\/OR-.*placed=1/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Confirmed");
  await expect(page.getByText("Thank you — your order is in.")).toBeVisible();
  const number = page.url().match(/orders\/([^?]+)/)![1];

  // Persisted state agrees with what was shown.
  const order = await orderByNumber(number);
  expect(order.status).toBe("CONFIRMED");
  expect(order.payment_status).toBe("AUTHORIZED");
  expect(order.substitution_policy).toBe("CONTACT");
  expect(order.fulfilment_type).toBe("DELIVERY");
  expect(order.ship_postal_code).toBe("RW1 1BT");
  expect(cents(order.subtotal)).toBe(4 * 399 + 429);
  expect(toCents(totalText)).toBe(cents(order.total));
  expect(cents(order.total)).toBe(cents(order.subtotal) - cents(order.coupon_discount) + cents(order.delivery_fee));
  const lines = await rows("SELECT name, ordered_qty FROM orders_orderitem WHERE order_id = $1 ORDER BY name", [order.id]);
  expect(lines.map((l) => [l.name, Number(l.ordered_qty)])).toEqual([["Large White Eggs", 1], ["Whole Milk", 4]]);
  const payment = await one("SELECT state, is_demo, amount FROM payments_payment WHERE order_id = $1", [order.id]);
  expect(payment.state).toBe("AUTHORIZED");
  expect(payment.is_demo).toBe(true);
  const milkAfter = await stock("whole-milk");
  expect(Number(milkAfter.reserved) - Number(milkBefore.reserved)).toBe(4); // reserved, not yet sold
  expect(Number(milkAfter.on_hand)).toBe(Number(milkBefore.on_hand));
  const moves = await rows("SELECT kind FROM inventory_stockmovement WHERE ref_type = 'order' AND ref_id = $1", [number]);
  expect(moves).toHaveLength(0); // the ledger records a SALE only when goods are actually picked, not when they are reserved
});

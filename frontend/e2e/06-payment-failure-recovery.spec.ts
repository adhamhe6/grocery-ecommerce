import { expect, test } from "@playwright/test";
import { cents, one, orderByNumber, rows, stock } from "./support/db";
import { cancelOpenOrdersFor, csrfHeaders } from "./support/api";
import { addProductFromPage, fillGuestDelivery, uniqueEmail } from "./support/ui";

const emails: string[] = [];
test.afterEach(async ({ request }) => cancelOpenOrdersFor(request, ...emails));
const PRODUCT = "toasted-sesame-oil"; // $5.99, plentiful stock; 4 units clear the delivery zone minimum

/** Workflow 6: payment fails → correct state stored → clear message → retry → provider confirms → states updated exactly once. */
test("a declined card keeps the order recoverable; retrying succeeds once and repeated provider events change nothing", async ({ page, request }) => {
  const email = uniqueEmail("retry");
  emails.push(email);
  const before = await stock(PRODUCT);

  await addProductFromPage(page, PRODUCT, 3);
  await page.goto("/checkout");
  await fillGuestDelivery(page, email);
  await page.getByRole("button", { name: /Place order & pay/ }).click();
  await expect(page).toHaveURL(/\/pay\/demo\/(demo_pi_\w+)/);
  const firstRef = page.url().match(/\/pay\/demo\/(demo_pi_\w+)/)![1];

  // The provider declines the card.
  await page.getByRole("button", { name: "Simulate a declined card" }).click();
  await expect(page).toHaveURL(/\/orders\/OR-/);
  const number = page.url().match(/orders\/([^?]+)/)![1];

  // Customer sees a clear message and a way forward; nothing was confirmed or lost.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/awaiting payment|payment/i);
  await expect(page.getByText("Payment needed to confirm this order")).toBeVisible();
  await expect(page.getByText(/declined/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay by card" })).toBeVisible();
  let order = await orderByNumber(number);
  expect(order.status).toBe("PENDING_PAYMENT");
  let payments = await rows("SELECT state, provider_reference FROM payments_payment WHERE order_id = $1 ORDER BY id", [order.id]);
  expect(payments.map((p) => p.state)).toEqual(["FAILED"]);
  const held = await stock(PRODUCT);
  expect(Number(held.reserved) - Number(before.reserved)).toBe(4); // the basket is still held for the retry window

  // Retry: a fresh attempt, then the provider confirms.
  await page.getByRole("button", { name: "Pay by card" }).click();
  await expect(page).toHaveURL(/\/pay\/demo\/(demo_pi_\w+)/);
  const secondRef = page.url().match(/\/pay\/demo\/(demo_pi_\w+)/)![1];
  expect(secondRef).not.toBe(firstRef);
  await page.getByRole("button", { name: "Simulate a successful payment" }).click();
  await expect(page).toHaveURL(/\/orders\/OR-.*placed=1/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Confirmed");

  order = await orderByNumber(number);
  expect(order.status).toBe("CONFIRMED");
  expect(order.payment_status).toBe("AUTHORIZED");
  payments = await rows("SELECT state FROM payments_payment WHERE order_id = $1 ORDER BY id", [order.id]);
  expect(payments.map((p) => p.state)).toEqual(["FAILED", "AUTHORIZED"]);
  expect(cents((await one("SELECT SUM(amount) AS s FROM payments_payment WHERE order_id = $1 AND state = 'AUTHORIZED'", [order.id])).s)).toBe(cents(order.authorized_amount));

  // Repeated provider events (the provider re-delivering "succeeded", a late "failed" for the old attempt) change nothing.
  const base = (page.url().split("/orders/")[0]);
  for (const [ref, outcome] of [[secondRef, "succeed"], [secondRef, "succeed"], [firstRef, "fail"]] as const) {
    await request.post(`${base}/api/v1/payments/demo/${ref}/`, { data: { outcome }, headers: await csrfHeaders(request) });
  }
  const after = await stock(PRODUCT);
  expect(Number(after.reserved) - Number(before.reserved)).toBe(4); // reserved once, never twice
  expect((await orderByNumber(number)).status).toBe("CONFIRMED");
  expect(await rows("SELECT id FROM orders_order WHERE contact_email = $1", [email])).toHaveLength(1);
  const allocations = await rows("SELECT state, qty FROM inventory_allocation a JOIN orders_orderitem i ON i.id = a.order_item_id WHERE i.order_id = $1", [order.id]);
  expect(allocations.reduce((sum, a) => sum + Number(a.qty), 0)).toBe(4);
  expect(new Set(allocations.map((a) => a.state))).toEqual(new Set(["RESERVED"]));
});

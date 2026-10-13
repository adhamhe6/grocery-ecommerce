import { expect, test } from "@playwright/test";
import { cancelOpenOrdersFor } from "./support/api";
import { cents, one, orderByNumber, rows, stock } from "./support/db";
import { addProductFromPage, demoEmail, signIn, uniqueEmail } from "./support/ui";

const emails: string[] = [];
test.afterEach(async ({ request }) => cancelOpenOrdersFor(request, ...emails));

/** Workflow 2: order produce by weight → estimate → picker records the real weight → final total → capture ≤ authorised → customer sees it. */
test("produce sold by weight is estimated at checkout, finalised from the picked weight and never overcharged", async ({ page, browser }) => {
  const email = uniqueEmail("weight");
  emails.push(email);
  const unitPrice = 189; // Bananas, $1.89 / kg
  const before = await stock("bananas");

  // Customer: 1.5 kg of bananas (step 0.25 from the 0.5 kg minimum) plus an item that clears nothing special — pickup has no minimum.
  await addProductFromPage(page, "bananas", 4); // 0.5 + 4 × 0.25 = 1.5 kg
  await expect(page.getByRole("group", { name: "Quantity of Bananas" })).toContainText("1.5");
  await page.goto("/checkout");
  await page.getByLabel("Full name").fill("Wendy Weigher");
  await page.getByLabel("Mobile number").first().fill("+1 555 0191");
  await page.getByLabel("Email for your order confirmation").fill(email);
  await page.getByRole("radio", { name: /Collect from a store/ }).check();
  const slot = page.getByRole("radio", { name: /–/ }).first();
  await expect(slot).toBeVisible({ timeout: 20_000 });
  await slot.check();

  // The shopper is told, before paying, that this is an estimate with a maximum charge.
  const summary = page.getByRole("complementary", { name: "Order summary" });
  await expect(summary.getByText("Estimated total")).toBeVisible();
  await expect(summary.getByText(/Your card is authorised for up to/)).toBeVisible();
  await page.getByRole("button", { name: /Place order & pay/ }).click();
  await page.getByRole("button", { name: "Simulate a successful payment" }).click();
  await expect(page).toHaveURL(/\/orders\/OR-.*placed=1/);
  const orderUrl = page.url();
  const number = orderUrl.match(/orders\/([^?]+)/)![1];

  let order = await orderByNumber(number);
  expect(cents(order.subtotal)).toBe(Math.round(1.5 * unitPrice)); // estimate: 1.5 kg × $1.89 = $2.835 → $2.84 (half-up)
  expect(cents(order.authorized_amount)).toBeGreaterThan(cents(order.total)); // tolerance buffer on the weighed line
  expect(order.final_total).toBeNull();
  await expect(page.getByText(/Priced by weight/)).toBeVisible();

  // Picker: weighs the bananas at 1.4 kg and completes the order.
  const picker = await (await browser.newContext()).newPage();
  await signIn(picker, demoEmail("picker"));
  await picker.goto(`/admin/picking/${number}`);
  await picker.getByRole("button", { name: /Start picking/ }).click();
  await picker.getByLabel("Weight on the scale").fill("1.4");
  await expect(picker.getByText(/no change|\+\$|−\$/).first()).toBeVisible(); // live price impact is shown before confirming
  await picker.getByRole("button", { name: /Confirm 1.4 kg/ }).click();
  await picker.getByRole("button", { name: /^Finish picking$/ }).click();
  await picker.getByRole("dialog").getByRole("button", { name: "Finish picking" }).click();
  await expect(picker.getByRole("dialog")).toBeHidden();
  await expect(picker.getByText("Being packed")).toBeVisible();

  // Packing charges the card for exactly the final total.
  await picker.getByRole("button", { name: /Packed — ready for pickup/ }).click();
  await confirm(picker);
  await expect(picker.getByText("Ready for pickup").first()).toBeVisible();
  order = await orderByNumber(number);
  expect(order.status).toBe("READY_FOR_PICKUP");
  expect(cents(order.final_total)).toBe(Math.round(1.4 * unitPrice)); // 1.4 kg × $1.89 = $2.646 → $2.65
  expect(cents(order.final_total)).toBeLessThanOrEqual(cents(order.authorized_amount)); // never above what was authorised
  const payment = await one("SELECT state, amount, captured_amount FROM payments_payment WHERE order_id = $1", [order.id]);
  expect(payment.state).toBe("CAPTURED");
  expect(cents(payment.captured_amount)).toBe(cents(order.final_total));
  expect(cents(payment.captured_amount)).toBeLessThan(cents(order.authorized_amount)); // the unused tolerance buffer was released, not charged

  // Handover completes the order.
  await picker.goto(`/admin/orders/${number}`);
  await picker.getByRole("button", { name: /Hand over|Complete|Mark collected/ }).first().click();
  await confirm(picker);
  await expect.poll(async () => (await orderByNumber(number)).status).toBe("COMPLETED");

  // Stock: the picked 1.4 kg left the shelf (and the reservation for 1.5 kg was fully released).
  const after = await stock("bananas");
  expect(Number(after.reserved)).toBeCloseTo(Number(before.reserved), 3);
  expect(Number(before.on_hand) - Number(after.on_hand)).toBeCloseTo(1.4, 3);
  const sale = await rows("SELECT qty_delta FROM inventory_stockmovement m JOIN catalog_product p ON p.id = m.product_id WHERE p.slug = 'bananas' AND m.kind = 'SALE' AND m.ref_type = 'order' AND m.ref_id = $1", [number]);
  expect(sale.reduce((sum, m) => sum + Number(m.qty_delta), 0)).toBeCloseTo(-1.4, 3);

  // The customer sees the final quantity and price on their order.
  await page.goto(orderUrl.replace("&placed=1", "").replace("?placed=1&", "?"));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Completed");
  await expect(page.getByText(/picked 1\.4 kg/)).toBeVisible();
  await expect(page.getByText("Order total")).toBeVisible();
  await expect(page.getByText("$2.65").first()).toBeVisible();
  await picker.context().close();
});

async function confirm(page: import("@playwright/test").Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button").filter({ hasNotText: /Cancel|Close/ }).last().click();
  await expect(dialog).toBeHidden();
}

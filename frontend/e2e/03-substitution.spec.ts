import { expect, test, type Page } from "@playwright/test";
import { cancelOpenOrdersFor, placeGuestPickupOrder, productId } from "./support/api";
import { cents, one, orderByNumber, rows } from "./support/db";
import { demoEmail, signIn, uniqueEmail } from "./support/ui";

const emails: string[] = [];
test.afterEach(async ({ request }) => cancelOpenOrdersFor(request, ...emails));

async function confirm(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button").filter({ hasNotText: /Cancel|Close/ }).last().click();
  await expect(dialog).toBeHidden();
}

/** Workflow 3: unavailable at picking → customer preference respected → substitute proposed → approval → totals → outcome recorded. */
test("an unavailable item is replaced only as the customer allowed, never at a higher price, and the outcome is recorded", async ({ page, request, browser }) => {
  const email = uniqueEmail("sub");
  emails.push(email);
  const placed = await placeGuestPickupOrder(request, [{ productId: await productId("soy-sauce"), quantity: "2" }, { productId: await productId("diced-tomatoes"), quantity: "3" }], { policy: "CONTACT", email });
  const orderUrl = `/orders/${placed.number}?token=${placed.token}`;
  const order = await orderByNumber(placed.number);
  const originalLine = await one("SELECT id, unit_price, ordered_qty FROM orders_orderitem WHERE order_id = $1 AND name = 'Diced Tomatoes'", [order.id]);

  const picker = await (await browser.newContext()).newPage();
  await signIn(picker, demoEmail("picker"));
  await picker.goto(`/admin/picking/${placed.number}`);
  await picker.getByRole("button", { name: /Start picking/ }).click();

  // The picker finds the soy sauce but not the diced tomatoes.
  const soy = picker.locator("li", { hasText: "Soy Sauce" }).first();
  await soy.getByRole("button", { name: /^Picked 2/ }).click();
  const tomatoes = picker.locator("li", { hasText: "Diced Tomatoes" }).first();
  await tomatoes.getByRole("button", { name: /Can't find it/ }).click();
  await expect(picker.getByRole("dialog")).toContainText("Customer's choice");
  await picker.getByLabel("Note (optional)").fill("shelf empty");
  await confirm(picker);
  await expect(picker.getByText("Marked unavailable")).toBeVisible();

  // The stock reserved for the missing line was released straight away.
  const allocations = await rows("SELECT state FROM inventory_allocation WHERE order_item_id = $1", [originalLine.id]);
  expect(allocations.every((a) => a.state === "RELEASED")).toBe(true);

  // The customer chose "ask me first", so a replacement must be proposed — and cannot just be applied.
  await picker.getByRole("button", { name: /Find a replacement/ }).click();
  const dialog = picker.getByRole("dialog");
  await expect(dialog).toContainText("The customer is asked to approve");
  const candidate = dialog.getByRole("radio").first();
  await expect(candidate).toBeVisible();
  const candidateName = (await candidate.locator("xpath=ancestor::label").locator("span").first().innerText()).split("\n")[0];
  await candidate.check();
  await picker.getByLabel("Note for the customer (optional)").fill("same size, different brand");
  await confirm(picker);
  await expect(picker.getByText(/Replacement proposed|Waiting for the customer/).first()).toBeVisible();
  const proposed = await rows("SELECT status, charged_unit_price, list_unit_price FROM orders_substitution WHERE order_item_id = $1", [originalLine.id]);
  expect(proposed).toHaveLength(1);
  expect(proposed[0].status).toBe("AWAITING_CUSTOMER");
  expect(cents(proposed[0].charged_unit_price)).toBeLessThanOrEqual(cents(originalLine.unit_price)); // never more than the original price

  // Picking cannot be finished until the customer answers.
  await expect(picker.getByRole("button", { name: /^Finish picking$/ })).toBeDisabled();

  // The customer sees the request on their order page and approves it.
  await page.goto(orderUrl);
  await expect(page.getByText("Your picker needs an answer")).toBeVisible();
  await expect(page.getByText(/Instead of/)).toContainText("Diced Tomatoes");
  await expect(page.getByText(/You.d pay/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Your picker needs an answer")).toBeHidden();
  expect((await rows("SELECT status FROM orders_substitution WHERE order_item_id = $1", [originalLine.id]))[0].status).toBe("APPROVED");

  // The picker now picks the approved substitute and finishes.
  await picker.reload();
  const sub = picker.locator("li", { hasText: candidateName }).first();
  await sub.getByRole("button", { name: /^Picked/ }).click();
  await picker.getByRole("button", { name: /^Finish picking$/ }).click();
  await confirm(picker);
  await expect(picker.getByText("Being packed")).toBeVisible();

  // Totals: the customer pays for 2 soy sauce + the substitute at no more than the original's price.
  const finished = await orderByNumber(placed.number);
  const soyLine = await one("SELECT line_total_final FROM orders_orderitem WHERE order_id = $1 AND name = 'Soy Sauce'", [order.id]);
  expect(cents(soyLine.line_total_final)).toBe(2 * 349);
  const subLine = await one("SELECT line_total_final, unit_price, ordered_qty FROM orders_orderitem WHERE order_id = $1 AND substitute_for_id = $2", [order.id, originalLine.id]);
  expect(cents(subLine.line_total_final)).toBeLessThanOrEqual(cents(originalLine.unit_price) * Number(originalLine.ordered_qty));
  expect(cents(finished.final_total)).toBeLessThanOrEqual(cents(finished.total)); // the customer never pays more than they were quoted
  const original = await one("SELECT status FROM orders_orderitem WHERE id = $1", [originalLine.id]);
  expect(original.status).toBe("SUBSTITUTED");

  // The customer was notified of the request and of the decision (email goes to the log in dev: channel says so honestly).
  const notes = await rows("SELECT kind, channel FROM notifications_notification WHERE order_id = $1", [order.id]);
  expect(notes.map((n) => n.kind)).toEqual(expect.arrayContaining(["SUBSTITUTION_REQUIRED", "SUBSTITUTION_DECIDED"]));

  // The outcome is on the customer's order page.
  await page.goto(orderUrl);
  await expect(page.getByText("Substitute").first()).toBeVisible();
  await expect(page.getByText(candidateName).first()).toBeVisible();
  await picker.context().close();
});

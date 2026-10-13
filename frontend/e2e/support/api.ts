import type { APIRequestContext } from "@playwright/test";
import { rows } from "./db";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** A same-origin API client that behaves like the storefront: session cookie + CSRF header + Origin. */
export async function csrfHeaders(request: APIRequestContext) {
  await request.get(`${BASE}/api/v1/auth/session/`);
  const token = (await request.storageState()).cookies.find((c) => c.name === "csrftoken")?.value ?? "";
  return { Origin: BASE, "X-CSRFToken": token };
}

export async function apiPost(request: APIRequestContext, path: string, data: unknown = {}, extra: Record<string, string> = {}) {
  const headers = { ...(await csrfHeaders(request)), ...extra };
  return request.post(`${BASE}/api/v1${path}`, { data, headers });
}

/** Cancels every still-open order placed with these contact emails, releasing stock and slots so specs don't starve each other. */
export async function cancelOpenOrdersFor(request: APIRequestContext, ...emails: string[]) {
  const open = await rows<{ number: string; tracking_token: string }>(
    "SELECT number, tracking_token FROM orders_order WHERE contact_email = ANY($1) AND status IN ('PENDING_PAYMENT','CONFIRMED')",
    [emails],
  );
  for (const o of open) await apiPost(request, `/orders/${o.number}/cancel/?token=${o.tracking_token}`, { reason: "e2e cleanup" });
}

export interface PlacedOrder { number: string; token: string; email: string }

/** Sets up a guest pickup order through the public API (used where checkout itself is not the thing under test). */
export async function placeGuestPickupOrder(
  request: APIRequestContext,
  items: { productId: number; quantity: string }[],
  opts: { policy?: "ALLOW" | "CONTACT" | "NONE"; payment?: "COD" | "CARD"; email: string; branchId?: number },
): Promise<PlacedOrder> {
  const branchId = opts.branchId ?? 1;
  for (const it of items) {
    const r = await apiPost(request, "/cart/items/", { product_id: it.productId, quantity: it.quantity });
    if (!r.ok()) throw new Error(`add to cart failed: ${r.status()} ${await r.text()}`);
  }
  const slots = await (await request.get(`${BASE}/api/v1/delivery-slots/`, { params: { kind: "PICKUP", branch: String(branchId) } })).json();
  const slot = slots.days[0].slots[0];
  const res = await apiPost(
    request,
    "/checkout/",
    {
      fulfilment_type: "PICKUP", branch_id: branchId, slot_id: slot.id, payment_method: opts.payment ?? "COD", substitution_policy: opts.policy ?? "ALLOW",
      contact: { name: "E2E Shopper", email: opts.email, phone: "+1 555 0123" },
    },
    { "Idempotency-Key": `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  );
  if (!res.ok()) throw new Error(`checkout failed: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  return { number: body.number, token: body.tracking_token, email: opts.email };
}

export async function productId(slug: string): Promise<number> {
  const r = await rows<{ id: number }>("SELECT id FROM catalog_product WHERE slug = $1", [slug]);
  return r[0].id;
}

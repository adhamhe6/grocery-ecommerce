"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Landmark } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { POLICY_OPTIONS } from "@/components/cart/cart-view";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, ChoiceGroup, Field, Input, Textarea, describedBy } from "@/components/ui/field";
import { ApiError, api, apiGet, newIdempotencyKey } from "@/lib/api";
import { useCart, useCartActions, useMe, useStore } from "@/lib/hooks";
import type { Address, Branch, OrderDetail, QuoteData, SlotsResponse, SubstitutionPolicy } from "@/lib/types";
import { SlotPicker } from "./slot-picker";
import { QuoteSummary } from "./quote-summary";

type Fulfilment = "DELIVERY" | "PICKUP";
type NewAddress = { recipient_name: string; phone: string; line1: string; line2: string; city: string; area: string; postal_code: string; instructions: string };
const EMPTY_ADDRESS: NewAddress = { recipient_name: "", phone: "", line1: "", line2: "", city: "", area: "", postal_code: "", instructions: "" };

function useDebounced<T>(value: T, ms = 450): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Step({ n, title, children, id }: { n: number; title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-line bg-white p-5 shadow-card sm:p-6">
      <h2 id={id} className="flex items-center gap-3 text-xl"><span className="num flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-fg" aria-hidden>{n}</span>{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function CheckoutView() {
  const router = useRouter();
  const qc = useQueryClient();
  const store = useStore();
  const { data: me, isLoading: meLoading } = useMe();
  const { data: cart, isLoading: cartLoading, error: cartError, refetch } = useCart();
  const { fix } = useCartActions();

  const [fulfilment, setFulfilment] = React.useState<Fulfilment>("DELIVERY");
  const [contact, setContact] = React.useState({ name: "", email: "", phone: "" });
  const [addressId, setAddressId] = React.useState<number | "new">("new");
  const [addr, setAddr] = React.useState<NewAddress>(EMPTY_ADDRESS);
  const [saveAddress, setSaveAddress] = React.useState(true);
  const [branchId, setBranchId] = React.useState<number | null>(null);
  const [slotId, setSlotId] = React.useState<number | null>(null);
  const [policy, setPolicy] = React.useState<SubstitutionPolicy | null>(null);
  const [note, setNote] = React.useState("");
  const [payment, setPayment] = React.useState<"CARD" | "COD">(store.payment.card_enabled ? "CARD" : "COD");
  const [formError, setFormError] = React.useState<ApiError | null>(null);
  const [changedQuote, setChangedQuote] = React.useState<QuoteData | null>(null);

  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => apiGet<Address[]>("/addresses/"), enabled: !!me });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => apiGet<Branch[]>("/branches/"), staleTime: 5 * 60_000 });
  const pickupBranches = (branches.data ?? []).filter((b) => b.offers_pickup);
  const canDeliver = (branches.data ?? []).some((b) => b.offers_delivery);

  // Pre-fill once the session is known: saved default address, account details.
  const prefilled = React.useRef(false);
  React.useEffect(() => {
    if (prefilled.current || meLoading) return;
    if (me) {
      setContact({ name: me.full_name, email: me.email, phone: me.phone });
    }
    prefilled.current = true;
  }, [me, meLoading]);
  React.useEffect(() => {
    if (!addresses.data?.length || addressId !== "new" || addr.line1) return;
    const d = addresses.data.find((a) => a.is_default) ?? addresses.data[0];
    setAddressId(d.id);
  }, [addresses.data, addressId, addr.line1]);
  React.useEffect(() => { if (!canDeliver && branches.data) setFulfilment("PICKUP"); }, [canDeliver, branches.data]);
  React.useEffect(() => { if (fulfilment === "PICKUP" && branchId == null && pickupBranches.length) setBranchId(cart?.branch_id && pickupBranches.some((b) => b.id === cart.branch_id) ? cart.branch_id : pickupBranches[0].id); }, [fulfilment, branchId, pickupBranches, cart?.branch_id]);

  const saved = typeof addressId === "number" ? addresses.data?.find((a) => a.id === addressId) : undefined;
  const destination = saved ? { postal_code: saved.postal_code, area: saved.area } : { postal_code: addr.postal_code.trim(), area: addr.area.trim() };
  const debouncedDest = useDebounced(destination);
  const destReady = fulfilment === "DELIVERY" && (debouncedDest.postal_code.length >= 3 || debouncedDest.area.length >= 2);

  const slots = useQuery({
    queryKey: ["slots", fulfilment, fulfilment === "PICKUP" ? branchId : debouncedDest],
    queryFn: () => apiGet<SlotsResponse>("/delivery-slots/", fulfilment === "PICKUP" ? { kind: "PICKUP", branch: branchId ?? undefined } : { kind: "DELIVERY", ...debouncedDest }),
    enabled: fulfilment === "PICKUP" ? branchId != null : destReady,
    retry: false,
    refetchInterval: 60_000,
  });
  // A slot only stays selected while it is still offered.
  React.useEffect(() => {
    if (slotId != null && slots.data && !slots.data.days.some((d) => d.slots.some((s) => s.id === slotId))) setSlotId(null);
  }, [slots.data, slotId]);
  React.useEffect(() => { setSlotId(null); }, [fulfilment, branchId]);

  const effectivePolicy: SubstitutionPolicy = policy ?? cart?.substitution_policy ?? "ALLOW";
  const contactComplete = !!(contact.name.trim() && contact.email.trim() && contact.phone.trim());
  const addressComplete = saved ? true : !!(addr.recipient_name.trim() && addr.phone.trim() && addr.line1.trim() && addr.city.trim() && (addr.postal_code.trim() || addr.area.trim()));

  const payload = React.useMemo(() => {
    const base: Record<string, unknown> = {
      fulfilment_type: fulfilment, slot_id: slotId, payment_method: payment, substitution_policy: effectivePolicy, customer_note: note.trim(),
    };
    if (!me) base.contact = { name: contact.name.trim(), email: contact.email.trim(), phone: contact.phone.trim() };
    else if (contact.phone.trim() !== me.phone) base.contact = { phone: contact.phone.trim() };
    if (fulfilment === "PICKUP") base.branch_id = branchId;
    else if (saved) base.address_id = saved.id;
    else { base.address = { ...addr, recipient_name: addr.recipient_name.trim() }; base.save_address = !!me && saveAddress; }
    return base;
  }, [fulfilment, slotId, payment, effectivePolicy, note, me, contact, branchId, saved, addr, saveAddress]);

  const ready = slotId != null && (fulfilment === "PICKUP" ? branchId != null : addressComplete) && contactComplete && !!cart?.can_checkout;
  const quotePayload = useDebounced(payload, 350);
  const quote = useQuery({
    queryKey: ["quote", quotePayload, cart?.totals.subtotal],
    queryFn: () => api<QuoteData>("/checkout/quote/", { method: "POST", body: quotePayload }),
    enabled: ready,
    retry: false,
    staleTime: 0,
  });
  const liveQuote = changedQuote ?? quote.data ?? null;
  React.useEffect(() => { setChangedQuote(null); }, [quotePayload]);

  // One idempotency key per distinct request body: a double click or a retry after a timeout can never create two orders.
  const attempt = React.useRef<{ sig: string; key: string } | null>(null);
  const place = useMutation({
    mutationFn: async () => {
      const body = { ...payload, expected_total: liveQuote?.total ?? null };
      const sig = JSON.stringify(body);
      if (attempt.current?.sig !== sig) attempt.current = { sig, key: newIdempotencyKey() };
      return api<OrderDetail>("/checkout/", { method: "POST", body, idempotencyKey: attempt.current.key });
    },
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: ["cart"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
      if (me) qc.invalidateQueries({ queryKey: ["addresses"] });
      const token = !me && order.tracking_token ? `token=${encodeURIComponent(order.tracking_token)}` : "";
      const url = order.payment?.checkout_url;
      if (url && order.payment?.state === "REQUIRES_ACTION") {
        try {
          const u = new URL(url, window.location.origin);
          if (u.origin === window.location.origin || u.hostname.endsWith(".local")) return router.push(`${u.pathname}${u.search}${token ? (u.search ? "&" : "?") + token : ""}`);
          if (u.protocol === "https:") return window.location.assign(u.toString());
        } catch { /* fall through to the order page, which can retry payment */ }
      }
      router.push(`/orders/${order.number}?placed=1${token ? "&" + token : ""}`);
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) return setFormError(new ApiError(0, "ERROR", "Something went wrong. Please try again."));
      setFormError(e);
      if (e.code === "CART_CHANGED" && (e.details as any)?.quote) setChangedQuote((e.details as any).quote as QuoteData);
      if (e.code === "DELIVERY_SLOT_UNAVAILABLE") { setSlotId(null); slots.refetch(); }
      qc.invalidateQueries({ queryKey: ["cart"] });
    },
  });

  if (cartLoading || meLoading) return <div className="mt-8 space-y-4" aria-busy="true"><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (cartError || !cart) return <ErrorState error={cartError} onRetry={() => refetch()} />;
  if (cart.lines.length === 0) return <EmptyState title="Your basket is empty" action={<ButtonLink href="/shop">Start shopping</ButtonLink>}>Add something to your basket before checking out.</EmptyState>;
  if (!me && !store.allow_guest_checkout) return <EmptyState title="Please sign in to check out" action={<ButtonLink href="/login?next=/checkout">Sign in</ButtonLink>}>Guest checkout isn&apos;t available at the moment.</EmptyState>;

  const fe = formError?.fieldErrors ?? {};
  const cartChangedItems = formError?.code === "CART_CHANGED" ? ((formError.details as any)?.items as { name: string; message: string }[] | undefined) : undefined;
  const totalChanged = formError?.code === "CART_CHANGED" && !!(formError.details as any)?.quote;
  const cardLabel = store.payment.mode === "demo" ? "Card (demonstration sandbox)" : "Credit or debit card";
  const submit = () => { setFormError(null); place.mutate(); };

  return (
    <form className="mt-6 grid gap-8 lg:grid-cols-[1fr_24rem]" onSubmit={(e) => { e.preventDefault(); if (ready && !place.isPending) submit(); }} noValidate>
      <div className="space-y-6">
        {!cart.can_checkout && <Alert tone="bad" title="Your basket needs attention first">Some items can&apos;t be supplied as requested. <Button type="button" variant="link" onClick={() => fix.mutate()}>Fix my basket</Button> or <Link className="font-semibold underline" href="/cart">review it</Link>.</Alert>}

        <Step n={1} title="Your details" id="step-contact">
          {me ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <p className="text-ink-2 sm:col-span-2">Ordering as <strong className="text-ink">{me.full_name}</strong> ({me.email}).</p>
              <Field label="Mobile number for the driver or picker" htmlFor="c-phone" required error={fe["contact.phone"]} hint="Only used about this order.">
                <Input id="c-phone" type="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} aria-invalid={!!fe["contact.phone"]} aria-describedby={describedBy("c-phone", true, !!fe["contact.phone"])} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <p className="text-sm text-ink-2 sm:col-span-2">Checking out as a guest. <Link href="/login?next=/checkout" className="font-semibold text-primary underline">Sign in</Link> to use saved addresses and see your order history.</p>
              <Field label="Full name" htmlFor="c-name" required error={fe["contact.name"]}><Input id="c-name" autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} aria-invalid={!!fe["contact.name"]} aria-describedby={describedBy("c-name", false, !!fe["contact.name"])} /></Field>
              <Field label="Mobile number" htmlFor="c-phone" required error={fe["contact.phone"]}><Input id="c-phone" type="tel" autoComplete="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} aria-invalid={!!fe["contact.phone"]} aria-describedby={describedBy("c-phone", false, !!fe["contact.phone"])} /></Field>
              <Field label="Email for your order confirmation" htmlFor="c-email" required error={fe["contact.email"]} className="sm:col-span-2"><Input id="c-email" type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} aria-invalid={!!fe["contact.email"]} aria-describedby={describedBy("c-email", false, !!fe["contact.email"])} /></Field>
            </div>
          )}
        </Step>

        <Step n={2} title="Delivery or collection" id="step-fulfilment">
          <ChoiceGroup name="fulfilment" legend="How would you like to receive your order?" value={fulfilment} onChange={(v) => setFulfilment(v)} options={[
            { value: "DELIVERY", title: "Delivery", description: "To your door, in a time slot you choose.", disabled: !canDeliver },
            { value: "PICKUP", title: "Collect from a store", description: "Free. We'll have it ready for you.", disabled: pickupBranches.length === 0 },
          ]} />
          {fulfilment === "DELIVERY" ? (
            <div className="mt-6">
              {me && (addresses.data?.length ?? 0) > 0 && (
                <fieldset className="mb-5 space-y-2">
                  <legend className="mb-2 text-sm font-semibold text-ink">Deliver to</legend>
                  {addresses.data!.map((a) => (
                    <label key={a.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-line-strong bg-white p-3.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                      <input type="radio" name="address" checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-1 size-4 accent-[var(--color-primary)]" />
                      <span className="text-sm"><span className="block font-semibold text-ink">{a.label || a.recipient_name}{a.is_default && " · Default"}</span>{[a.line1, a.line2, a.city, a.postal_code].filter(Boolean).join(", ")}</span>
                    </label>
                  ))}
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border border-line-strong bg-white p-3.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                    <input type="radio" name="address" checked={addressId === "new"} onChange={() => setAddressId("new")} className="size-4 accent-[var(--color-primary)]" />
                    <span className="text-sm font-semibold text-ink">Use a new address</span>
                  </label>
                </fieldset>
              )}
              {addressId === "new" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {([
                    ["recipient_name", "Recipient name", "name", "sm:col-span-1"], ["phone", "Phone for this address", "tel", "sm:col-span-1"], ["line1", "Address line 1", "address-line1", "sm:col-span-2"], ["line2", "Address line 2 (optional)", "address-line2", "sm:col-span-2"],
                    ["city", "Town or city", "address-level2", "sm:col-span-1"], ["postal_code", "Postcode", "postal-code", "sm:col-span-1"], ["area", "Area / neighbourhood (optional)", "address-level3", "sm:col-span-2"],
                  ] as const).map(([k, label, ac, span]) => {
                    const err = fe[`address.${k}`];
                    return (
                      <Field key={k} label={label} htmlFor={`a-${k}`} required={!label.includes("optional")} error={err} className={span}>
                        <Input id={`a-${k}`} autoComplete={ac} value={addr[k]} onChange={(e) => setAddr({ ...addr, [k]: e.target.value })} aria-invalid={!!err} aria-describedby={describedBy(`a-${k}`, false, !!err)} />
                      </Field>
                    );
                  })}
                  <Field label="Delivery instructions (optional)" htmlFor="a-instructions" className="sm:col-span-2" hint="Gate codes, where to leave the bags, a safe place.">
                    <Textarea id="a-instructions" maxLength={300} value={addr.instructions} onChange={(e) => setAddr({ ...addr, instructions: e.target.value })} />
                  </Field>
                  {me && <Checkbox className="sm:col-span-2" label="Save this address to my account" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />}
                  {fe["address"] && <p role="alert" className="text-sm font-medium text-bad sm:col-span-2">{fe["address"]}</p>}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 space-y-2">
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-semibold text-ink">Collect from</legend>
                {pickupBranches.map((b) => (
                  <label key={b.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-line-strong bg-white p-3.5 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                    <input type="radio" name="branch" checked={branchId === b.id} onChange={() => setBranchId(b.id)} className="mt-1 size-4 accent-[var(--color-primary)]" />
                    <span className="text-sm"><span className="block font-semibold text-ink">{b.name}</span>{b.address}{b.pickup_instructions && <span className="mt-1 block text-ink-3">{b.pickup_instructions}</span>}</span>
                  </label>
                ))}
              </fieldset>
              {fe["branch_id"] && <p role="alert" className="text-sm font-medium text-bad">{fe["branch_id"]}</p>}
            </div>
          )}
        </Step>

        <Step n={3} title={fulfilment === "DELIVERY" ? "Choose a delivery slot" : "Choose a collection time"} id="step-slot">
          <SlotPicker data={slots.data} loading={slots.isFetching && !slots.data} error={slots.error} value={slotId} onChange={setSlotId} kind={fulfilment} />
          {fe["slot_id"] && <p role="alert" className="mt-2 text-sm font-medium text-bad">{fe["slot_id"]}</p>}
          <p className="mt-3 text-xs text-ink-3">Your slot is held for you when you place the order. Card orders must be paid within a short window, or the slot is released.</p>
        </Step>

        <Step n={4} title="If something is unavailable" id="step-subs">
          <ChoiceGroup name="policy" legend="Substitutions" value={effectivePolicy} onChange={setPolicy} options={POLICY_OPTIONS} />
          <Field label="Note for the picker or driver (optional)" htmlFor="note" className="mt-5"><Textarea id="note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </Step>

        <Step n={5} title="Payment" id="step-payment">
          <ChoiceGroup name="payment" legend="Pay by" value={payment} onChange={setPayment} options={[
            ...(store.payment.card_enabled ? [{ value: "CARD" as const, title: cardLabel, description: store.payment.mode === "demo" ? "You'll be taken to a simulated payment page. No card is charged and no money moves." : "You'll be taken to our payment provider to enter your card. Your bank is only asked to authorise the maximum amount; you're charged the final amount after picking." }] : []),
            ...(store.payment.cod_enabled ? [{ value: "COD" as const, title: fulfilment === "DELIVERY" ? "Pay on delivery" : "Pay at the store", description: "Pay for the final amount when you receive your order." }] : []),
          ]} />
          {!store.payment.card_enabled && !store.payment.cod_enabled && <Alert tone="warn" title="Payments aren't set up yet">This store can&apos;t take orders until a payment method is enabled.</Alert>}
        </Step>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start" aria-label="Order summary">
        <QuoteSummary cart={cart} quote={liveQuote} loading={ready && quote.isFetching && !changedQuote} quoteError={ready ? quote.error : null} ready={ready} fulfilment={fulfilment} />
        {formError && !totalChanged && (
          <Alert tone="bad" title={formError.code === "CART_CHANGED" ? "Your basket changed" : "We couldn't place your order"}>
            {formError.message}
            {cartChangedItems && <ul className="mt-1 list-disc pl-4">{cartChangedItems.map((i) => <li key={i.name}><strong>{i.name}:</strong> {i.message}</li>)}</ul>}
            {formError.code === "CART_CHANGED" && <p className="mt-2"><Link href="/cart" className="font-semibold underline">Review your basket</Link></p>}
            {formError.requestId && <p className="mt-1 text-xs text-ink-3">Reference: {formError.requestId}</p>}
          </Alert>
        )}
        {totalChanged && <Alert tone="warn" title="The total changed">Prices or delivery changed since you last looked. Please check the updated total above, then confirm again.</Alert>}
        <Button type="submit" size="lg" className="w-full" loading={place.isPending} disabled={!ready || place.isPending || (!store.payment.card_enabled && !store.payment.cod_enabled)}>
          {payment === "CARD" ? <><CreditCard className="size-5" aria-hidden /> Place order &amp; pay</> : <><Landmark className="size-5" aria-hidden /> Place order</>}
        </Button>
        {!ready && <p className="text-center text-sm text-ink-3" role="status">{!contactComplete ? "Enter your details" : slotId == null ? "Choose a slot" : "Complete the sections above"} to place your order.</p>}
        <p className="text-center text-xs text-ink-3">By placing your order you agree to our <Link className="underline" href="/p/terms">terms</Link> and <Link className="underline" href="/p/substitutions">substitution &amp; weight policy</Link>.</p>
        <p className="sr-only" aria-live="polite">{place.isPending ? "Placing your order" : ""}</p>
        
      </aside>
    </form>
  );
}

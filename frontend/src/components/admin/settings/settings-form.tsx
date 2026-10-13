"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Card } from "@/components/admin/kit";
import { serverFormErrors } from "@/components/admin/finance/server-errors";
import { formatInZone } from "@/components/admin/finance/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { adminRequest, useAdminAction } from "@/lib/admin";
import { useStore } from "@/lib/hooks";
import { LogoField } from "./logo-field";
import { changedKeys, buildSettingsPatch, currencyPreview, formFromSettings, providerInfo, SETTINGS_FIELDS, SOCIAL_FIELDS, validateSettings, visibleSocialCount, type SettingsForm, type StoreSettingsData } from "./settings-model";
import { ColourField, Impact, TextInput, Toggle, type FormCtx } from "./settings-parts";


function listOf(kind: "timeZone" | "currency"): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(kind) ?? [];
  } catch {
    return [];
  }
}

/** The whole settings form. `latest` is whatever the API returned last; local edits are kept until saved or discarded. */
export function SettingsFormView({ latest }: { latest: StoreSettingsData }) {
  const router = useRouter();
  const store = useStore();
  const [server, setServer] = React.useState<StoreSettingsData>(latest);
  const [initial, setInitial] = React.useState<SettingsForm>(() => formFromSettings(latest));
  const [form, setForm] = React.useState<SettingsForm>(() => formFromSettings(latest));
  const [conflict, setConflict] = React.useState(false);
  const [touched, setTouched] = React.useState(false);

  const dirtyKeys = changedKeys(initial, form);
  const dirty = dirtyKeys.length > 0;

  // Keep in step with the API without throwing away unsaved edits: logo/timestamp changes are adopted quietly, a change to
  // any field someone else saved is adopted if we have no edits and otherwise offered as an explicit reload.
  React.useEffect(() => {
    const fresh = formFromSettings(latest);
    if (changedKeys(initial, fresh).length === 0) {
      if (latest.updated_at !== server.updated_at || latest.logo !== server.logo) setServer(latest);
      setConflict(false);
    } else if (!dirty) {
      setServer(latest); setInitial(fresh); setForm(fresh); setConflict(false);
    } else {
      setConflict(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  // Closing the tab with unsaved edits asks first.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = React.useCallback((patch: Partial<SettingsForm>) => setForm((f) => ({ ...f, ...patch })), []);
  const local = touched ? validateSettings(form) : {};
  const save = useAdminAction(
    (body: Record<string, string | number | boolean>) => adminRequest<StoreSettingsData>("PATCH", "/settings/", body),
    {
      invalidate: ["/settings"],
      success: "Settings saved",
      onSuccess: (saved) => {
        const fresh = formFromSettings(saved);
        setServer(saved); setInitial(fresh); setForm(fresh); setTouched(false); setConflict(false);
        router.refresh();
      },
    },
  );
  const serverErrors = serverFormErrors(save.error, SETTINGS_FIELDS);
  const errors = { ...serverErrors.fields, ...local };
  const c: FormCtx = { form, set: (p) => { set(p); save.reset(); }, errors };

  const timeZones = React.useMemo(() => listOf("timeZone"), []);
  const currencies = React.useMemo(() => listOf("currency"), []);
  const provider = providerInfo(store.payment.mode);
  const preview = currencyPreview(form.currency, form.locale);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const problems = validateSettings(form);
    if (Object.keys(problems).length > 0) {
      const first = Object.keys(problems)[0];
      document.getElementById(`s-${first}`)?.focus();
      return;
    }
    if (dirty && !save.isPending) save.mutate(buildSettingsPatch(initial, form));
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {conflict && (
        <Alert tone="warn" title="These settings were changed by someone else">
          <p>Your unsaved edits are still here. Saving will overwrite only the fields you changed.</p>
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => { const fresh = formFromSettings(latest); setServer(latest); setInitial(fresh); setForm(fresh); setConflict(false); }}>Discard my edits and load the latest</Button>
        </Alert>
      )}
      {touched && Object.keys(local).length > 0 && <Alert tone="bad" title="Some fields need attention">Fix the highlighted fields below, then save again.</Alert>}
      {serverErrors.form && <Alert tone="bad" title="The settings weren't saved">{serverErrors.form}</Alert>}

      <Card title="Store identity">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput c={c} name="name" label="Store name" required maxLength={80} impact="the header, footer, browser tab titles and the sign-in pages." />
          <TextInput c={c} name="legal_name" label="Legal name" maxLength={160} hint="Registered company name." impact="nothing on the storefront today; it isn't displayed anywhere." />
          <TextInput c={c} name="tagline" label="Tagline" required maxLength={140} className="md:col-span-2" impact="the footer and the default page title." />
        </div>
        <div className="mt-5 border-t border-line pt-5"><LogoField logo={server.logo} onChanged={(s) => (s ? setServer(s) : setServer((prev) => ({ ...prev, logo: null })))} /></div>
      </Card>

      <Card title="Contact details and opening hours">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput c={c} name="support_email" label="Contact email" type="email" inputMode="email" required impact="the footer, and where customers are told to write." />
          <TextInput c={c} name="support_phone" label="Contact phone" type="tel" inputMode="tel" maxLength={40} impact="the footer, as a tap-to-call link." />
          <TextInput c={c} name="support_hours" label="Opening hours" maxLength={160} hint="Free text, for example “Mon–Sat 8am–8pm, Sun 10am–4pm”. It is shown exactly as typed; it doesn't change delivery slots." className="md:col-span-2" />
          <TextInput c={c} name="address" label="Address" multiline hint="Shown as typed." className="md:col-span-2" />
        </div>
      </Card>

      <Card title="Currency, language, time zone and tax">
        <datalist id="s-currencies">{currencies.map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="s-timezones">{timeZones.map((v) => <option key={v} value={v} />)}</datalist>
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput c={c} name="currency" label="Currency" required maxLength={3} list="s-currencies" hint={preview ? <>Example: <span className="num font-semibold">{preview}</span>. Use a 3-letter code such as USD or EUR.</> : "Use a 3-letter code such as USD or EUR."} impact="how every price is displayed. It doesn't convert any prices, and existing orders keep the currency they were placed in." />
          <TextInput c={c} name="locale" label="Language and number format" required maxLength={16} hint="A language tag such as en-US or fr-CA." impact="how prices and numbers are formatted." />
          <TextInput c={c} name="timezone" label="Time zone" required maxLength={64} list="s-timezones" hint="An IANA name such as Europe/London or America/New_York." impact="where a reporting day starts and ends, and the time zone delivery times are shown in." />
          <TextInput c={c} name="tax_label" label="Tax name" required maxLength={30} impact="the label next to the tax amount in the checkout summary." />
        </div>
        <div className="mt-4"><Toggle c={c} name="prices_include_tax" title="Listed prices already include tax" description="Turn off if tax is added on top of the listed price." impact="how new carts and orders calculate their total: when on, tax is shown as already included; when off, it is added at checkout. Existing orders are unchanged." /></div>
      </Card>

      <Card title="Brand colours">
        <div className="grid gap-6 md:grid-cols-2">
          <ColourField c={c} name="brand_primary" label="Primary colour" usage={<>Headers, primary buttons and links. <Impact>every page of the storefront and this dashboard, within about a minute of saving.</Impact></>} />
          <ColourField c={c} name="brand_accent" label="Accent colour" usage={<>Highlights and secondary calls to action. <Impact>every page of the storefront, within about a minute of saving.</Impact></>} />
        </div>
        <p className="mt-4 text-sm text-ink-3">Both colours carry white text, so each should reach a contrast of at least 4.5:1 against white (WCAG AA). You can still save a lower value, but the check will keep warning you.</p>
      </Card>

      <Card title="Order policies">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput c={c} name="min_order_value" label="Minimum order value" inputMode="decimal" hint={`In ${form.currency.toUpperCase() || "store currency"}. Use 0 for no minimum.`} impact="checkout. Carts with a subtotal below this are refused (a delivery area's own minimum applies too, whichever is higher)." />
          <TextInput c={c} name="weight_tolerance_percent" label="Weight tolerance (%)" inputMode="decimal" hint="Between 0 and 50." impact="weighed items: pickers may pick up to this much over the ordered weight without a manager, and cards are authorised for this much extra on weighed lines." />
          <TextInput c={c} name="complaint_window_hours" label="Complaint window (hours)" inputMode="numeric" hint="Between 1 and 720." impact="how long after receiving an order a customer can report a problem with it." />
        </div>
        <div className="mt-4 space-y-4">
          <Toggle c={c} name="substitution_price_cap" title="Cap the price of substitutes" description="Customers never pay more for a substitute than for the item it replaces." impact="the price customers are charged when a picker substitutes an item." />
          <Toggle c={c} name="allow_guest_checkout" title="Allow checkout without an account" impact="whether visitors can place an order without signing in. Turn off and they are asked to sign in or register." />
        </div>
      </Card>

      <Card title="Payment methods">
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-md border border-line bg-paper-2/50 p-3 text-sm">
          <div className="flex items-center gap-2"><span className="font-semibold">Card payment provider</span><Badge tone={provider.tone === "ok" ? "ok" : provider.tone === "warn" ? "warn" : "info"}>{provider.label}</Badge></div>
          <p className="basis-full text-ink-2">{provider.text} This is set on the server and can&apos;t be changed here.</p>
          {store.payment.mode === "demo" && <p className="basis-full font-semibold text-warn">Demo mode never moves money.</p>}
        </div>
        <div className="space-y-4">
          <Toggle c={c} name="card_payments_enabled" title="Accept card payments" description={store.payment.mode === "unconfigured" ? "Switched on here, but unavailable until a provider is configured on the server." : undefined} impact="whether “card” is offered at checkout." />
          <Toggle c={c} name="cash_on_delivery_enabled" title="Accept cash on delivery or at pickup" impact="whether “pay on delivery” is offered at checkout. At least one method must stay on." />
        </div>
      </Card>

      <Card title="Social links">
        <div className="grid gap-4 md:grid-cols-2">
          {SOCIAL_FIELDS.map(([key, label]) => <TextInput key={key} c={c} name={key} label={`${label} URL`} type="url" inputMode="url" placeholder="https://…" hint={key === "instagram_url" ? "Leave blank to hide a network. Links must start with https://" : undefined} />)}
        </div>
        <div className="mt-4 space-y-2">
          <Toggle c={c} name="socials_are_placeholders" title="These social links are placeholders" description="Tick while the links above are example addresses that still need replacing." impact="the storefront footer. While ticked, no social links are shown at all." />
          <p className="pl-8 text-sm text-ink-2" role="status">
            {form.socials_are_placeholders
              ? <><Badge tone="warn" className="mr-2">Placeholders</Badge>The footer currently hides every social link. Replace the links above with your real accounts, then untick the box.</>
              : visibleSocialCount(form) > 0
                ? `The footer will show ${visibleSocialCount(form)} social ${visibleSocialCount(form) === 1 ? "link" : "links"}.`
                : "No social links are filled in, so the footer shows none."}
          </p>
        </div>
      </Card>

      <Card title="Demonstration notice">
        <Toggle c={c} name="demo_mode" title="Show the demonstration-store notice" description="For sample or test shops." impact="the storefront: a banner and footer note say products, prices and stock are sample data, and search engines are asked not to index the site." />
      </Card>

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <p className="text-sm text-ink-2" role="status">
          {dirty ? <><strong className="text-ink">{dirtyKeys.length} unsaved {dirtyKeys.length === 1 ? "change" : "changes"}.</strong></> : <>No unsaved changes. Last saved {formatInZone(server.updated_at, store.locale, store.timezone)}.</>}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setForm(initial); setTouched(false); save.reset(); }} disabled={!dirty || save.isPending}>Discard changes</Button>
          <Button type="submit" loading={save.isPending} disabled={!dirty}>Save settings</Button>
        </div>
      </div>
    </form>
  );
}

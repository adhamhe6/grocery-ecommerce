"use client";

// One line on the pick sheet. Built for a phone held in an aisle: large targets, one obvious primary button, and the
// server's verdict (e.g. WEIGHT_OUT_OF_TOLERANCE) shown right under the line it is about.
import { Check, Minus, PackageX, Plus, Repeat, Scale, StickyNote, Trash2, UserRoundCheck } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/states";
import { useAdmin } from "@/lib/admin";
import { cn } from "@/lib/cn";
import { formatDate, formatQty } from "@/lib/format";
import { useMoney, useStore } from "@/lib/hooks";
import { effectivePolicy, POLICY_SHORT } from "./actions";
import { checkPick, compareDecimal, decimalInput, priceImpact, stepFor, stepQty, subQty } from "./decimal";
import { ItemStatusBadge, StorageTag, ToleranceNote } from "./order-items";
import { ErrorAlert, useAsyncTask, type useOrderApi } from "./shared";
import type { OrderDetail, StaffItem, SubstitutionRow } from "./types";

export interface LineHandlers {
  onUnavailable: (item: StaffItem) => void;
  onSubstitute: (item: StaffItem) => void;
  onRemove: (item: StaffItem) => void;
  onDecide: (s: SubstitutionRow) => void;
}

interface LineProps extends LineHandlers {
  order: OrderDetail;
  item: StaffItem;
  call: ReturnType<typeof useOrderApi>;
  /** The server refused to finish picking because of this line. */
  flagged: boolean;
  onActed: (itemId: number) => void;
}

function Thumb({ item }: { item: StaffItem }) {
  return item.image
    ? <img src={item.image} alt="" loading="lazy" className="size-14 shrink-0 rounded-md border border-line bg-paper-2 object-cover" />
    : <div className="size-14 shrink-0 rounded-md border border-line bg-paper-2" aria-hidden />;
}

function Heading({ item, order, original }: { item: StaffItem; order: OrderDetail; original?: StaffItem }) {
  const policy = effectivePolicy(order.substitution_policy, item.substitution_pref);
  return (
    <div className="min-w-0 flex-1">
      <h4 className="font-sans text-base font-bold leading-snug text-ink">{item.name}</h4>
      <p className="text-xs text-ink-3">{item.sku}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <StorageTag storage={item.storage} />
        {item.is_variable_weight && <Badge tone="neutral"><Scale className="size-3" aria-hidden />Weighed</Badge>}
        {!item.is_substitute && policy !== "ALLOW" && <Badge tone={policy === "NONE" ? "neutral" : "warn"}>{policy === "NONE" ? "No substitutes" : "Contact me first"}</Badge>}
        {item.is_substitute && <Badge tone="info"><Repeat className="size-3" aria-hidden />Substitute{original ? ` for ${original.name}` : ""}</Badge>}
      </div>
    </div>
  );
}

function Lots({ item }: { item: StaffItem }) {
  const store = useStore();
  if (!item.lots.length) return null;
  return (
    <p className="mt-2 text-xs text-ink-2">
      Take from: {item.lots.slice(0, 3).map((l) => `lot ${l.lot}${l.expiry ? ` (use by ${formatDate(l.expiry, store.locale, { day: "numeric", month: "short" })})` : ""}`).join(" · ")}
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ the line
export function PickLine(props: LineProps) {
  const { order, item } = props;
  const original = item.substitute_for ? order.items.find((i) => i.id === item.substitute_for) : undefined;
  const frame = cn("rounded-lg border bg-white p-4 shadow-sm", props.flagged ? "border-bad ring-2 ring-bad/30" : "border-line");
  const flag = props.flagged && (
    <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-bad" role="alert"><PackageX className="size-4" aria-hidden />Still to do — finish this line before picking can be completed.</p>
  );

  switch (item.status) {
    case "PENDING":
      return <li id={`line-${item.id}`} className={frame}>{flag}<PendingLine {...props} original={original} /></li>;
    case "UNAVAILABLE":
      return <li id={`line-${item.id}`} className={frame}>{flag}<UnavailableLine {...props} original={original} /></li>;
    case "PROPOSED": {
      const sub = order.substitutions.find((s) => s.item_id === item.substitute_for && s.status === "AWAITING_CUSTOMER");
      return (
        <li id={`line-${item.id}`} className={frame}>
          {flag}
          <div className="flex gap-3"><Thumb item={item} /><Heading item={item} order={order} original={original} /></div>
          <Alert tone="warn" title="Waiting for the customer to approve this replacement" className="mt-3">
            {sub && <ManagerAnswer sub={sub} onDecide={props.onDecide} />}
          </Alert>
        </li>
      );
    }
    default:
      return <li id={`line-${item.id}`}><FinishedLine {...props} original={original} /></li>;
  }
}

/** Compact summary for lines that are done, replaced or removed. */
function FinishedLine({ order, item, original }: LineProps & { original?: StaffItem }) {
  const money = useMoney();
  const replacement = order.items.find((i) => i.substitute_for === item.id && i.status !== "REMOVED");
  const note =
    item.status === "SUBSTITUTED" ? `Replaced by ${replacement?.name ?? "a substitute"}`
    : item.status === "REMOVED" ? "Removed — the customer isn't charged for this"
    : `Picked ${formatQty(item.picked_qty, item.unit)} of ${formatQty(item.ordered_qty, item.unit)}`;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-paper-2/60 px-4 py-3">
      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", item.status === "PICKED" ? "bg-ok text-white" : "bg-sand text-ink-2")} aria-hidden><Check className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{item.name}{original && <span className="font-normal text-ink-3"> (substitute for {original.name})</span>}</p>
        <p className="text-sm text-ink-2">{note}</p>
        {item.picker_note && <p className="text-xs text-ink-3">Note: {item.picker_note}</p>}
        {item.status === "SHORT" && <p className="text-xs font-semibold text-warn">Short-picked: the customer pays for what was picked.</p>}
      </div>
      <div className="shrink-0 text-right">
        <ItemStatusBadge status={item.status} label={item.status === "REMOVED" ? "Removed" : undefined} />
        {item.line_total_final !== null && item.status !== "SUBSTITUTED" && <p className="num mt-1 text-sm font-semibold">{money(item.line_total_final)}</p>}
      </div>
    </div>
  );
}

function ManagerAnswer({ sub, onDecide }: { sub: SubstitutionRow; onDecide: (s: SubstitutionRow) => void }) {
  const { can } = useAdmin();
  if (!can("orders.manage")) return <span className="text-sm">A manager can record the customer&apos;s answer if they replied by phone.</span>;
  return <Button size="sm" variant="secondary" className="mt-2" onClick={() => onDecide(sub)}><UserRoundCheck className="size-4" aria-hidden />Record customer&apos;s answer</Button>;
}

// ------------------------------------------------------------------------------------------------ unavailable
function UnavailableLine({ order, item, original, onSubstitute, onRemove, onDecide }: LineProps & { original?: StaffItem }) {
  const awaiting = order.substitutions.find((s) => s.item_id === item.id && s.status === "AWAITING_CUSTOMER");
  const policy = effectivePolicy(order.substitution_policy, item.substitution_pref);
  return (
    <div>
      <div className="flex gap-3"><Thumb item={item} /><Heading item={item} order={order} original={original} /></div>
      <Alert tone="bad" title="Marked unavailable" className="mt-3">{item.picker_note || "No reason recorded."}</Alert>
      {awaiting ? (
        <Alert tone="warn" title={`Replacement proposed: ${awaiting.substitute}`} className="mt-3">
          Waiting for the customer to answer. Picking can&apos;t be finished until they do.
          <ManagerAnswer sub={awaiting} onDecide={onDecide} />
        </Alert>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {policy !== "NONE" && <Button size="lg" className="flex-1 basis-40" onClick={() => onSubstitute(item)}><Repeat className="size-5" aria-hidden />Find a replacement</Button>}
          <Button size="lg" variant="secondary" className="flex-1 basis-40" onClick={() => onRemove(item)}><Trash2 className="size-5" aria-hidden />Remove line</Button>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-3">Customer&apos;s choice: {POLICY_SHORT[policy].toLowerCase()}.</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ picking controls
function differenceText(diff: string, money: (v: string) => string): string {
  const sign = compareDecimal(diff, "0");
  return sign === 0 || sign === null ? "no change" : `${sign === 1 ? "+" : "−"}${money(diff.replace(/^-/, ""))}`;
}

function PendingLine({ order, item, call, onActed, onUnavailable, original }: LineProps & { original?: StaffItem }) {
  const money = useMoney();
  const { can } = useAdmin();
  const task = useAsyncTask();
  const weighed = item.is_variable_weight;
  const [raw, setRaw] = React.useState(weighed ? "" : item.ordered_qty);
  const [note, setNote] = React.useState("");
  const [showNote, setShowNote] = React.useState(false);
  const [override, setOverride] = React.useState(false);
  const inputId = `qty-${item.id}`;
  const msgId = `qty-msg-${item.id}`;

  const check = checkPick({ raw, ordered: item.ordered_qty, weighed, window: item.tolerance });
  const step = stepFor(item.ordered_qty);
  const impact = check.chargedQty && (weighed || check.status === "short") ? priceImpact(item.unit_price, check.chargedQty, item.line_total_estimated) : null;
  const canOverride = can("orders.manage");
  const blocked =
    check.status === "empty" || check.status === "invalid" || check.status === "zero" || check.status === "over_ordered" || (check.status === "over_window" && !(canOverride && override));

  let message: { tone: "ok" | "warn" | "bad" | "neutral"; text: string } | null = null;
  if (check.status === "invalid") message = { tone: "bad", text: "Enter a number with at most 3 decimals, like 1.250." };
  else if (check.status === "zero") message = { tone: "warn", text: "Nothing picked? Use “Can't find it” instead." };
  else if (check.status === "over_ordered") message = { tone: "bad", text: `The customer ordered ${item.ordered_qty} ${item.unit}; you can't pick more.` };
  else if (check.status === "over_window") message = { tone: "bad", text: `Heavier than the ${item.tolerance?.max} ${item.unit} allowed.${canOverride ? " Choose a smaller piece, or override as a manager." : " Choose a smaller piece, or ask a manager to override."}` };
  else if (check.status === "short" && weighed) message = { tone: "warn", text: `Lighter than ${item.tolerance?.min} ${item.unit}: recorded as short-picked.` };
  else if (check.status === "short") message = { tone: "warn", text: `Short by ${subQty(item.ordered_qty, check.qty)} ${item.unit}: recorded as short-picked.` };

  const submit = async () => {
    if (blocked || !check.qty) return;
    const done = await task.run(() => call(`items/${item.id}/pick/`, { picked_qty: check.qty, note: note.trim(), override: check.status === "over_window" && override }));
    if (done) onActed(item.id);
  };

  const label = weighed ? "Weight on the scale" : "Quantity picked";
  const maxQty = weighed ? undefined : item.ordered_qty;
  const buttonText = !check.qty || blocked ? (weighed ? "Enter the weight" : "Enter a quantity") : check.status === "short" ? `Pick ${check.qty} ${item.unit} (short)` : `${weighed ? "Confirm" : "Picked"} ${check.qty} ${item.unit}`;

  return (
    <div>
      <div className="flex gap-3">
        <Thumb item={item} />
        <Heading item={item} order={order} original={original} />
        <div className="shrink-0 text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Ordered</p>
          <p className="num text-xl font-bold leading-tight text-ink">{formatQty(item.ordered_qty)}</p>
          <p className="text-xs text-ink-2">{item.unit} · {money(item.unit_price)} each</p>
        </div>
      </div>
      <Lots item={item} />
      {item.is_substitute && <p className="mt-2 text-xs text-info">Replacement approved for this order. The customer pays {money(item.unit_price)} per {item.unit}, never more than the original.</p>}
      {weighed && item.tolerance && (
        <p className="mt-2 text-sm text-ink-2">
          Accepted: <strong className="num text-ink">{item.tolerance.min}–{item.tolerance.max} {item.unit}</strong> (ordered {item.ordered_qty} {item.unit}, ±{formatQty(order.policy.weight_tolerance_percent)}%).
        </p>
      )}

      <div className="mt-3">
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold text-ink">{label} <span className="font-normal text-ink-3">({item.unit})</span></label>
        <div className="flex items-stretch gap-2">
          {!weighed && <Button type="button" variant="secondary" size="icon" className="h-13 w-13" aria-label={`Decrease ${item.name}`} onClick={() => setRaw((r) => stepQty(r, -1, step, maxQty))}><Minus className="size-5" aria-hidden /></Button>}
          <Input id={inputId} inputMode="decimal" autoComplete="off" className={cn("h-13 text-center text-xl font-semibold", weighed && "text-left")} placeholder={weighed ? "0.000" : undefined}
            value={raw} aria-invalid={check.status === "invalid" || check.status === "over_ordered" || check.status === "over_window"} aria-describedby={message || impact ? msgId : undefined}
            onChange={(e) => setRaw(decimalInput(e.target.value))} />
          {!weighed && <Button type="button" variant="secondary" size="icon" className="h-13 w-13" aria-label={`Increase ${item.name}`} onClick={() => setRaw((r) => stepQty(r, 1, step, maxQty))}><Plus className="size-5" aria-hidden /></Button>}
        </div>
        <div id={msgId} aria-live="polite" className="mt-1.5 space-y-1 text-sm">
          {message && <p className={message.tone === "bad" ? "font-medium text-bad" : "font-medium text-warn"}>{message.text}</p>}
          {impact && (
            <p className="text-ink-2">
              Customer pays about <strong className="num text-ink">{money(impact.charged)}</strong> (quoted {money(item.line_total_estimated)}; {differenceText(impact.difference, money)}).
            </p>
          )}
        </div>
      </div>

      {check.status === "over_window" && canOverride && (
        <Checkbox className="mt-2 text-sm" checked={override} onChange={(e) => setOverride(e.target.checked)}
          label={<span><strong>Manager override.</strong> Accept {check.qty} {item.unit}. The customer is still only charged for {item.tolerance?.max} {item.unit}; the store absorbs the rest.</span>} />
      )}

      {showNote ? (
        <div className="mt-3">
          <label htmlFor={`note-${item.id}`} className="mb-1.5 block text-sm font-semibold text-ink">Note (optional)</label>
          <Input id={`note-${item.id}`} value={note} maxLength={300} placeholder="e.g. smaller pack, different best-before" onChange={(e) => setNote(e.target.value)} />
        </div>
      ) : (
        <button type="button" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline" onClick={() => setShowNote(true)}><StickyNote className="size-4" aria-hidden />Add a note</button>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="lg" className="h-13 flex-[2] basis-48" disabled={blocked} loading={task.busy} onClick={submit}>{!task.busy && <Check className="size-5" aria-hidden />}{buttonText}</Button>
        <Button size="lg" variant="secondary" className="h-13 flex-1 basis-32" disabled={task.busy} onClick={() => onUnavailable(item)}><PackageX className="size-5" aria-hidden />Can&apos;t find it</Button>
      </div>
      {task.error != null && <ErrorAlert error={task.error} />}
      {weighed && <ToleranceNote item={item} percent={order.policy.weight_tolerance_percent} />}
    </div>
  );
}

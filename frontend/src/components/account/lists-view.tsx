"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ListChecks, Pencil, Plus, ShoppingBasket, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { useForm } from "react-hook-form";
import { ProductImage } from "@/components/product/product-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input, describedBy } from "@/components/ui/field";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { listNameSchema, type ListNameValues } from "@/lib/account-schemas";
import { useListActions, useProductSearch, useShoppingLists } from "@/lib/account-hooks";
import type { ShoppingList } from "@/lib/account-types";
import { cn } from "@/lib/cn";
import { pluralise } from "@/lib/format";
import { applyApiErrors } from "@/lib/form-errors";
import { useMoney } from "@/lib/hooks";
import type { CartData } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";

type ListResult = NonNullable<CartData["list_result"]>;
const MAX_QTY = 9_999_999; // the API stores quantities with 7 integer digits and 3 decimals

// ------------------------------------------------------------------ create / rename
function NameForm({ list, onDone }: { list?: ShoppingList; onDone: () => void }) {
  const { create, rename } = useListActions();
  const toast = useToast();
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ListNameValues>({ resolver: zodResolver(listNameSchema), defaultValues: { name: list?.name ?? "" } });
  const pending = create.isPending || rename.isPending;

  const onSubmit = handleSubmit(({ name }) => {
    setFormError(null);
    const opts = {
      onSuccess: () => { toast.success(list ? "List renamed" : "List created"); onDone(); },
      onError: (e: unknown) => applyApiErrors(e, setError, setFormError, { fields: ["name"] }),
    };
    if (list) rename.mutate({ id: list.id, name }, opts);
    else create.mutate(name, opts);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert tone="bad">{formError}</Alert>}
      <Field label="List name" htmlFor="list-name" error={errors.name?.message} hint="For example Weekly shop or Sunday roast.">
        <Input id="list-name" autoComplete="off" maxLength={80} aria-invalid={!!errors.name} aria-describedby={describedBy("list-name", true, !!errors.name)} {...register("name")} />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose asChild><Button variant="secondary" disabled={pending}>Cancel</Button></DialogClose>
        <Button type="submit" loading={pending}>{list ? "Save name" : "Create list"}</Button>
      </div>
    </form>
  );
}

function NameDialog({ open, onOpenChange, list }: { open: boolean; onOpenChange: (o: boolean) => void; list?: ShoppingList }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={list ? "Rename list" : "New shopping list"}>
        {open && <NameForm list={list} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ items
function ItemRow({ list, item, onRemoved }: { list: ShoppingList; item: ShoppingList["items"][number]; onRemoved: () => void }) {
  const { setItem, removeItem } = useListActions();
  const toast = useToast();
  const saved = String(Number(item.quantity)); // the API may send "1E+1" for 10
  const [qty, setQty] = React.useState(saved);
  React.useEffect(() => setQty(saved), [saved]);
  const n = Number(qty);
  const valid = qty.trim() !== "" && Number.isFinite(n) && n > 0 && n <= MAX_QTY;
  const changed = valid && Number(n.toFixed(3)) !== Number(saved);
  const inputId = `qty-${list.id}-${item.product_id}`;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed) return;
    setItem.mutate(
      { listId: list.id, productId: item.product_id, quantity: String(Number(n.toFixed(3))) },
      { onSuccess: () => toast.success(`Updated ${item.name}`), onError: (err) => toast.error(err) },
    );
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <Link href={`/product/${item.slug}`} className="min-w-0 flex-1 basis-48 font-semibold text-ink hover:underline">{item.name}</Link>
      <form onSubmit={save} className="flex items-center gap-2" noValidate>
        <label htmlFor={inputId} className="sr-only">Quantity of {item.name}</label>
        <Input id={inputId} type="number" inputMode="decimal" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} aria-invalid={!valid} aria-describedby={valid ? undefined : `${inputId}-error`} className="num h-10 w-24" />
        {changed && <Button type="submit" size="sm" loading={setItem.isPending}>Save</Button>}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Remove ${item.name} from ${list.name}`}
          loading={removeItem.isPending}
          onClick={() => removeItem.mutate({ listId: list.id, productId: item.product_id }, { onSuccess: onRemoved, onError: (err) => toast.error(err) })}
        >
          {!removeItem.isPending && <Trash2 className="size-4" aria-hidden />}
        </Button>
      </form>
      {!valid && <p id={`${inputId}-error`} className="basis-full text-sm font-medium text-bad">Enter a quantity above zero.</p>}
    </li>
  );
}

function AddProducts({ list }: { list: ShoppingList }) {
  const [term, setTerm] = React.useState("");
  const search = useProductSearch(term);
  const { setItem } = useListActions();
  const toast = useToast();
  const money = useMoney();
  const inList = new Set(list.items.map((i) => i.product_id));
  const id = `add-product-${list.id}`;
  const typed = term.trim();
  const results = search.data?.results ?? [];
  const showResults = typed.length >= 2 && search.data && search.term === typed;

  return (
    <div className="space-y-3">
      <Field label="Add a product" htmlFor={id} hint="Search by name (at least 2 letters), then choose Add.">
        <Input id={id} type="search" autoComplete="off" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search for milk, apples, bread…" />
      </Field>
      <div aria-live="polite" className="text-sm text-ink-2 empty:hidden">
        {typed.length >= 2 && (search.isFetching || search.term !== typed) && "Searching…"}
        {showResults && !search.isFetching && results.length === 0 && `No products match “${typed}”. Try a shorter word.`}
        {search.isError && "We couldn't search just now. Please try again."}
      </div>
      {showResults && results.length > 0 && (
        <ul className={cn("divide-y divide-line rounded-md border border-line bg-white transition-opacity", search.isPlaceholderData && "opacity-60")} aria-busy={search.isPlaceholderData || undefined}>
          {results.map((p) => {
            const added = inList.has(p.id);
            const adding = setItem.isPending && setItem.variables?.productId === p.id && setItem.variables.listId === list.id;
            return (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <div className="w-12 shrink-0"><ProductImage image={p.image} className="rounded" sizes="48px" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                  <p className="num text-sm text-ink-3">{p.pack_label} · {money(p.price)}{!p.availability.can_order && " · Out of stock right now"}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={added}
                  loading={adding}
                  aria-label={added ? `${p.name} is already in ${list.name}` : `Add ${p.name} to ${list.name}`}
                  onClick={() => setItem.mutate({ listId: list.id, productId: p.id, quantity: String(Number(p.quantity.min)) }, { onSuccess: () => toast.success(`Added ${p.name}`), onError: (err) => toast.error(err) })}
                >
                  {added ? "In list" : <><Plus className="size-4" aria-hidden /> Add</>}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one list
function ListCard({ list, defaultOpen, onBasketResult }: { list: ShoppingList; defaultOpen: boolean; onBasketResult: (listName: string, r: ListResult) => void }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [renaming, setRenaming] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const { addToCart, remove } = useListActions();
  const toast = useToast();
  const itemsHeading = React.useRef<HTMLHeadingElement>(null);
  const empty = list.items.length === 0;

  return (
    <li className="rounded-lg border border-line bg-white">
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg p-4 hover:bg-paper sm:p-5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block truncate font-sans text-base font-bold text-ink">{list.name}</span>
            <span className="block text-sm text-ink-3">{list.items.length === 0 ? "Empty" : pluralise(list.items.length, "product")}</span>
          </span>
          <ChevronDown className="size-5 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        {open && (
          <div className="space-y-6 border-t border-line p-4 sm:p-5">
            <div className="flex flex-wrap gap-2">
              <Button
                loading={addToCart.isPending}
                disabled={empty}
                onClick={() => addToCart.mutate(list.id, { onSuccess: (cart) => onBasketResult(list.name, cart.list_result ?? { added: [], skipped: [] }), onError: (e) => toast.error(e) })}
              >
                <ShoppingBasket className="size-4" aria-hidden /> Add all to basket
              </Button>
              <Button variant="secondary" onClick={() => setRenaming(true)} aria-label={`Rename ${list.name}`}><Pencil className="size-4" aria-hidden /> Rename</Button>
              <Button variant="ghost" className="text-bad hover:bg-bad-soft" onClick={() => setDeleting(true)} aria-label={`Delete ${list.name}`}><Trash2 className="size-4" aria-hidden /> Delete list</Button>
            </div>
            {empty && <p className="text-sm text-ink-2">Nothing in this list yet. Search below to add products.</p>}
            {!empty && (
              <div>
                <h3 ref={itemsHeading} tabIndex={-1} className="font-sans text-sm font-bold uppercase tracking-wider text-ink focus:outline-none">Products</h3>
                <ul className="mt-1 divide-y divide-line">
                  {list.items.map((item) => <ItemRow key={item.product_id} list={list} item={item} onRemoved={() => itemsHeading.current?.focus()} />)}
                </ul>
              </div>
            )}
            <AddProducts list={list} />
          </div>
        )}
      </details>

      <NameDialog open={renaming} onOpenChange={setRenaming} list={list} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete “${list.name}”?`}
        description={<p>This removes the list{empty ? "" : ` and its ${pluralise(list.items.length, "product")}`}. Your basket and favourites aren&apos;t affected.</p>}
        confirmLabel="Delete list"
        pending={remove.isPending}
        onConfirm={() => remove.mutate(list.id, { onSuccess: () => { toast.success("List deleted"); setDeleting(false); }, onError: (e) => toast.error(e) })}
      />
    </li>
  );
}

/** Says what really went into the basket and, for anything that didn't, why not. */
export function ListBasketResult({ listName, result, onDismiss }: { listName: string; result: ListResult; onDismiss: () => void }) {
  const total = result.added.length + result.skipped.length;
  const title =
    result.added.length === 0
      ? `Nothing from “${listName}” could be added`
      : result.skipped.length === 0
        ? `Added all ${pluralise(result.added.length, "product")} from “${listName}” to your basket`
        : `Added ${result.added.length} of ${pluralise(total, "product")} from “${listName}”`;
  return (
    <Alert tone={result.added.length > 0 && result.skipped.length === 0 ? "ok" : "warn"} title={title}>
      <div className="mt-2 space-y-3 text-ink-2">
        {result.added.length > 0 && (
          <div>
            <p className="font-semibold text-ink">In your basket</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{result.added.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}
        {result.skipped.length > 0 && (
          <div>
            <p className="font-semibold text-ink">Not added</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{result.skipped.map((s) => <li key={s.name}>{s.name}: {s.reason}</li>)}</ul>
          </div>
        )}
        {result.added.length > 0 && <p className="text-sm text-ink-3">Amounts are added to anything already in your basket.</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {result.added.length > 0 && <ButtonLink href="/cart" size="sm">View basket</ButtonLink>}
          <Button size="sm" variant="secondary" onClick={onDismiss}>Dismiss</Button>
        </div>
      </div>
    </Alert>
  );
}

// ------------------------------------------------------------------ page
export function ListsView() {
  const q = useShoppingLists();
  const [creating, setCreating] = React.useState(false);
  const [basket, setBasket] = React.useState<{ listName: string; result: ListResult } | null>(null);
  const lists = q.data ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl">Shopping lists</h1>
          <p className="mt-1 text-ink-2">Keep the things you buy again and again, and add a whole list to your basket in one go.</p>
        </div>
        {lists.length > 0 && <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> New list</Button>}
      </div>

      <div aria-live="polite" className="mt-5 empty:hidden">
        {basket && <ListBasketResult listName={basket.listName} result={basket.result} onDismiss={() => setBasket(null)} />}
      </div>

      <div className="mt-6">
        {q.isLoading && (
          <ul className="space-y-3" aria-busy="true" aria-label="Loading your lists">
            {Array.from({ length: 3 }, (_, i) => <li key={i}><Skeleton className="h-[4.5rem] w-full" /></li>)}
          </ul>
        )}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} title="We couldn't load your lists" />}
        {q.data && lists.length === 0 && (
          <EmptyState icon={<ListChecks className="size-6" aria-hidden />} title="No shopping lists yet" action={<Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden /> Create your first list</Button>}>
            A list is a set of products and quantities you can add to your basket together.
          </EmptyState>
        )}
        {lists.length > 0 && (
          <>
            <p className="sr-only" role="status">{pluralise(lists.length, "list")}</p>
            <ul className="space-y-3">
              {lists.map((l) => <ListCard key={l.id} list={l} defaultOpen={lists.length === 1} onBasketResult={(listName, result) => setBasket({ listName, result })} />)}
            </ul>
          </>
        )}
      </div>

      <NameDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

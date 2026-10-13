"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Heart, LogOut, Menu, Package, Scale, Search, ShoppingBasket, UserRound, LayoutDashboard, MapPin, ListChecks, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Sheet } from "@/components/ui/dialog";
import { useAuthActions, useCart, useCartDrawer, useCompare, useMe, useMoney, useStore } from "@/lib/hooks";
import type { CategoryNode } from "@/lib/types";
import { Logo } from "./logo";
import { SearchBox } from "./search-box";

function DepartmentNav({ departments }: { departments: CategoryNode[] }) {
  return (
    <nav aria-label="Departments" className="hidden border-t border-line lg:block">
      <ul className="container-x flex items-center gap-0.5">
        {departments.map((d) => (
          <li key={d.id} className="group relative">
            <Link href={`/shop?category=${d.slug}`} className="flex items-center gap-1 whitespace-nowrap px-2.5 py-3 text-[0.9rem] font-semibold text-ink hover:text-primary" aria-haspopup={d.children?.length ? "true" : undefined}>
              {d.name}{!!d.children?.length && <ChevronDown className="size-3.5 text-ink-3 transition-transform group-hover:rotate-180 group-focus-within:rotate-180" aria-hidden />}
            </Link>
            {!!d.children?.length && (
              <div className="invisible absolute left-0 top-full z-40 w-72 translate-y-1 rounded-b-lg border border-t-0 border-line-strong bg-white p-2 opacity-0 shadow-pop transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
                <Link href={`/shop?category=${d.slug}`} className="block rounded px-3 py-2 text-sm font-semibold text-accent hover:bg-paper">Shop all {d.name}</Link>
                <ul>
                  {d.children.map((c) => (
                    <li key={c.id}><Link href={`/shop?category=${c.slug}`} className="flex items-center justify-between rounded px-3 py-2 text-sm hover:bg-paper-2"><span>{c.name}</span><span className="num text-xs text-ink-3">{c.count}</span></Link></li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
        <li className="ml-auto flex items-center gap-1">
          <Link href="/offers" className="whitespace-nowrap px-2.5 py-3 text-[0.9rem] font-semibold text-accent hover:underline">Offers</Link>
          <Link href="/new" className="hidden whitespace-nowrap px-2.5 py-3 text-[0.9rem] font-semibold text-ink hover:text-primary xl:block">New in</Link>
          <Link href="/guides" className="hidden whitespace-nowrap px-2.5 py-3 text-[0.9rem] font-semibold text-ink hover:text-primary xl:block">Recipes &amp; guides</Link>
        </li>
      </ul>
    </nav>
  );
}

function MobileMenu({ departments, open, onOpenChange }: { departments: CategoryNode[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const close = () => onOpenChange(false);
  const store = useStore();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} side="left" title={store.name} widthClass="w-[min(100vw,22rem)]">
      <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-2 py-2">
        <ul>
          {departments.map((d) => (
            <li key={d.id} className="border-b border-line">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3.5 font-semibold text-ink">
                  {d.name}<ChevronDown className="size-4 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="pb-2 pl-3">
                  <li><Link href={`/shop?category=${d.slug}`} onClick={close} className="block rounded px-3 py-2.5 text-sm font-semibold text-accent">Shop all {d.name}</Link></li>
                  {d.children?.map((c) => <li key={c.id}><Link href={`/shop?category=${c.slug}`} onClick={close} className="flex justify-between rounded px-3 py-2.5 text-sm hover:bg-paper-2"><span>{c.name}</span><span className="num text-ink-3">{c.count}</span></Link></li>)}
                </ul>
              </details>
            </li>
          ))}
        </ul>
        <ul className="mt-2">
          {[["/offers", "Offers"], ["/new", "New in"], ["/guides", "Recipes & guides"], ["/stores", "Stores & opening hours"], ["/faq", "Help & FAQs"], ["/track", "Track an order"]].map(([href, label]) => (
            <li key={href}><Link href={href} onClick={close} className="block px-3 py-3 font-medium text-ink hover:bg-paper-2">{label}</Link></li>
          ))}
        </ul>
      </nav>
    </Sheet>
  );
}

function AccountMenu() {
  const { data: me } = useMe();
  const { logout } = useAuthActions();
  const router = useRouter();
  if (!me) {
    return (
      <Link href="/login" className="flex h-11 items-center gap-2 rounded-md px-2.5 font-semibold text-ink hover:bg-paper-2 sm:px-3">
        <UserRound className="size-5" aria-hidden /><span className="hidden sm:inline">Sign in</span>
      </Link>
    );
  }
  const item = "flex cursor-pointer items-center gap-2.5 rounded px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-primary-soft";
  return (
    <DM.Root>
      <DM.Trigger className="flex h-11 items-center gap-2 rounded-md px-2.5 font-semibold text-ink hover:bg-paper-2 sm:px-3" aria-label="Account menu">
        <UserRound className="size-5" aria-hidden /><span className="hidden max-w-[7rem] truncate sm:inline">{me.full_name.split(" ")[0]}</span><ChevronDown className="size-3.5 text-ink-3" aria-hidden />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-md border border-line-strong bg-white p-1.5 shadow-pop">
          <div className="px-3 py-2"><p className="truncate text-sm font-semibold">{me.full_name}</p><p className="truncate text-xs text-ink-3">{me.email}</p></div>
          <DM.Separator className="my-1 h-px bg-line" />
          {me.is_staff_user && <DM.Item className={item} onSelect={() => router.push("/admin")}><LayoutDashboard className="size-4" aria-hidden /> Staff dashboard</DM.Item>}
          <DM.Item className={item} onSelect={() => router.push("/account/orders")}><Package className="size-4" aria-hidden /> Orders</DM.Item>
          <DM.Item className={item} onSelect={() => router.push("/account/favorites")}><Heart className="size-4" aria-hidden /> Favourites</DM.Item>
          <DM.Item className={item} onSelect={() => router.push("/account/lists")}><ListChecks className="size-4" aria-hidden /> Shopping lists</DM.Item>
          <DM.Item className={item} onSelect={() => router.push("/account/addresses")}><MapPin className="size-4" aria-hidden /> Addresses</DM.Item>
          <DM.Item className={item} onSelect={() => router.push("/account")}><Settings className="size-4" aria-hidden /> Account settings</DM.Item>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item className={item} onSelect={() => logout.mutate(undefined, { onSuccess: () => router.push("/") })}><LogOut className="size-4" aria-hidden /> Sign out</DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function SiteHeader({ departments, logoUrl }: { departments: CategoryNode[]; logoUrl?: string | null }) {
  const store = useStore();
  const { data: cart } = useCart();
  const { setOpen } = useCartDrawer();
  const compare = useCompare();
  const money = useMoney();
  const [menu, setMenu] = React.useState(false);
  const [mobileSearch, setMobileSearch] = React.useState(false);
  const count = cart?.item_count ?? 0;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg">Skip to content</a>
      <div className="container-x flex h-[4.25rem] items-center gap-2 sm:gap-4">
        <button className="-ml-2 rounded-md p-2.5 hover:bg-paper-2 lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><Menu className="size-6" aria-hidden /></button>
        <Logo name={store.name} logoUrl={logoUrl ?? store.logo} className="shrink-0" />
        <SearchBox className="mx-auto hidden w-full max-w-2xl md:block" />
        <div className="ml-auto flex items-center gap-0.5 sm:gap-1 md:ml-0">
          <button className="rounded-md p-2.5 hover:bg-paper-2 md:hidden" onClick={() => setMobileSearch((s) => !s)} aria-label="Search" aria-expanded={mobileSearch}><Search className="size-6" aria-hidden /></button>
          <Link href="/compare" className="relative hidden rounded-md p-2.5 hover:bg-paper-2 sm:block" aria-label={`Compare products${compare.ids.length ? ` (${compare.ids.length})` : ""}`}>
            <Scale className="size-6" aria-hidden />{compare.ids.length > 0 && <span className="num absolute right-0.5 top-0.5 flex size-4.5 items-center justify-center rounded-full bg-citrus text-[0.7rem] font-bold text-ink">{compare.ids.length}</span>}
          </Link>
          <AccountMenu />
          <button onClick={() => setOpen(true)} className="relative flex h-11 items-center gap-2 rounded-md bg-primary px-3 font-semibold text-primary-fg hover:bg-primary-hover sm:px-4" aria-label={`Basket, ${count} ${count === 1 ? "item" : "items"}`}>
            <ShoppingBasket className="size-5" aria-hidden />
            <span className="num hidden sm:inline">{count > 0 ? money(cart?.totals.subtotal) : "Basket"}</span>
            {count > 0 && <span className="num flex size-5 items-center justify-center rounded-full bg-citrus text-xs font-bold text-ink" aria-hidden>{count}</span>}
          </button>
        </div>
      </div>
      {mobileSearch && <div className="container-x pb-3 md:hidden"><SearchBox autoFocus onDone={() => setMobileSearch(false)} /></div>}
      <DepartmentNav departments={departments} />
      <MobileMenu departments={departments} open={menu} onOpenChange={setMenu} />
    </header>
  );
}


"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import {
  BarChart3, Boxes, ChevronDown, ClipboardList, CreditCard, FileText, Gift, Home, LayoutDashboard, LogOut, Menu, MessageSquare, Package, PackageSearch, Percent, Receipt, ScrollText,
  Settings, ShieldCheck, ShoppingBag, Store, Tag, Truck, Users, UserCog, Warehouse, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { AdminProvider, useAdmin, useAdminPermissions } from "@/lib/admin";
import { useAuthActions, useMe, useStore } from "@/lib/hooks";

interface NavItem { href: string; label: string; icon: React.ComponentType<{ className?: string }>; any?: string[] }
interface NavGroup { title: string; items: NavItem[] }

/** Every item is hidden unless the role has at least one of its capabilities — the API enforces the same rules. */
export const NAV: NavGroup[] = [
  { title: "Overview", items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, any: ["reports.read"] }] },
  { title: "Orders", items: [
    { href: "/admin/orders", label: "Orders", icon: ShoppingBag, any: ["orders.read"] },
    { href: "/admin/picking", label: "Picking queue", icon: ClipboardList, any: ["orders.fulfil"] },
    { href: "/admin/cases", label: "Support cases", icon: MessageSquare, any: ["support.manage"] },
    { href: "/admin/customers", label: "Customers", icon: Users, any: ["customers.read"] },
  ] },
  { title: "Catalogue", items: [
    { href: "/admin/products", label: "Products", icon: Package, any: ["catalog.read"] },
    { href: "/admin/taxonomy", label: "Categories & brands", icon: Tag, any: ["catalog.write", "catalog.merchandise"] },
    { href: "/admin/reviews", label: "Reviews", icon: ShieldCheck, any: ["catalog.merchandise", "catalog.write"] },
  ] },
  { title: "Inventory", items: [
    { href: "/admin/inventory", label: "Stock", icon: Warehouse, any: ["inventory.read"] },
    { href: "/admin/inventory/batches", label: "Batches & expiry", icon: Boxes, any: ["inventory.read"] },
    { href: "/admin/suppliers", label: "Suppliers", icon: Store, any: ["purchasing.read"] },
    { href: "/admin/purchase-orders", label: "Purchase orders", icon: Receipt, any: ["purchasing.read"] },
    { href: "/admin/replenishment", label: "Replenishment", icon: PackageSearch, any: ["purchasing.read"] },
  ] },
  { title: "Delivery", items: [
    { href: "/admin/branches", label: "Stores & zones", icon: Home, any: ["branches.manage", "slots.manage"] },
    { href: "/admin/slots", label: "Delivery slots", icon: Truck, any: ["slots.manage"] },
  ] },
  { title: "Marketing", items: [
    { href: "/admin/promotions", label: "Promotions & coupons", icon: Percent, any: ["promotions.manage"] },
    { href: "/admin/content", label: "Banners & pages", icon: FileText, any: ["content.manage"] },
    { href: "/admin/newsletter", label: "Newsletter & messages", icon: Gift, any: ["content.manage"] },
  ] },
  { title: "Finance & reports", items: [
    { href: "/admin/payments", label: "Payments & refunds", icon: CreditCard, any: ["finance.read"] },
    { href: "/admin/reports", label: "Reports", icon: BarChart3, any: ["reports.read"] },
  ] },
  { title: "Administration", items: [
    { href: "/admin/staff", label: "Staff & roles", icon: UserCog, any: ["staff.manage"] },
    { href: "/admin/settings", label: "Store settings", icon: Settings, any: ["settings.manage"] },
    { href: "/admin/audit", label: "Audit log", icon: ScrollText, any: ["audit.read"] },
  ] },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { canAny } = useAdmin();
  const path = usePathname();
  const store = useStore();
  const isActive = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));
  return (
    <div className="flex h-full flex-col bg-primary text-primary-fg">
      <div className="flex h-16 items-center border-b border-white/15 px-5"><Logo name={store.name} logoUrl={store.logo} light /></div>
      <nav aria-label="Dashboard" className="flex-1 overflow-y-auto px-3 py-4">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.any || canAny(...i.any));
          if (!items.length) return null;
          return (
            <div key={g.title} className="mb-5">
              <p className="px-3 pb-1.5 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-white/55">{g.title}</p>
              <ul>
                {items.map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link href={href} onClick={onNavigate} aria-current={isActive(href) ? "page" : undefined}
                      className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-white/85 hover:bg-white/10", isActive(href) && "bg-white/15 text-white")}>
                      <Icon className="size-[1.1rem] shrink-0" aria-hidden />{label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/15 p-3"><Link href="/" className="block rounded-md px-3 py-2 text-sm font-medium text-white/85 hover:bg-white/10">← View storefront</Link></div>
    </div>
  );
}

function BranchSwitcher() {
  const { branches, branchId, setBranchId, perms } = useAdmin();
  if (branches.length <= 1 && !perms.branch_scope.global) return <p className="hidden text-sm font-medium text-ink-2 sm:block">{branches[0]?.name}</p>;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only sm:not-sr-only sm:font-semibold sm:text-ink-2">Store</span>
      <Select className="h-9 w-auto min-w-36 py-0 text-sm" value={branchId ?? ""} onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : null)}>
        {perms.branch_scope.global && <option value="">All stores</option>}
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
    </label>
  );
}

function UserMenu() {
  const { perms } = useAdmin();
  const { logout } = useAuthActions();
  const router = useRouter();
  return (
    <DM.Root>
      <DM.Trigger className="flex h-9 items-center gap-2 rounded-md px-2.5 text-sm font-semibold hover:bg-paper-2" aria-label="Your account">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-fg" aria-hidden>{perms.full_name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-32 truncate sm:inline">{perms.full_name}</span><ChevronDown className="size-3.5 text-ink-3" aria-hidden />
      </DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-md border border-line-strong bg-white p-1.5 shadow-pop">
          <div className="px-3 py-2"><p className="truncate text-sm font-semibold">{perms.full_name}</p><p className="truncate text-xs text-ink-3">{perms.email}</p><p className="mt-1 text-xs font-semibold text-accent">{perms.role_label}</p></div>
          <DM.Separator className="my-1 h-px bg-line" />
          <DM.Item className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm outline-none data-[highlighted]:bg-primary-soft" onSelect={() => router.push("/account")}>Account settings</DM.Item>
          <DM.Item className="flex cursor-pointer items-center gap-2 rounded px-3 py-2 text-sm outline-none data-[highlighted]:bg-primary-soft" onSelect={() => logout.mutate(undefined, { onSuccess: () => router.push("/") })}><LogOut className="size-4" aria-hidden /> Sign out</DM.Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const path = usePathname();
  React.useEffect(() => setOpen(false), [path]);
  return (
    <div className="min-h-dvh bg-paper-2/70 lg:grid lg:grid-cols-[16.5rem_1fr]">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-fg">Skip to content</a>
      <aside className="sticky top-0 hidden h-dvh lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} aria-label="Close navigation" />
          <div className="relative h-full w-[min(18rem,86vw)] shadow-pop"><Sidebar onNavigate={() => setOpen(false)} />
            <button onClick={() => setOpen(false)} className="absolute right-2 top-3 rounded p-2 text-white/80 hover:bg-white/10" aria-label="Close"><X className="size-5" aria-hidden /></button>
          </div>
        </div>
      )}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-paper/95 px-4 backdrop-blur lg:px-8">
          <button className="-ml-2 rounded-md p-2 hover:bg-paper-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu className="size-6" aria-hidden /></button>
          <div className="ml-auto flex items-center gap-3"><BranchSwitcher /><UserMenu /></div>
        </header>
        <main id="admin-main" className="px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Auth + capability gate for everything under /admin. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { data: me, isLoading: meLoading } = useMe();
  const perms = useAdminPermissions();
  React.useEffect(() => { if (!meLoading && !me) router.replace(`/login?next=${encodeURIComponent(path)}`); }, [me, meLoading, router, path]);
  if (meLoading || (me && perms.isLoading)) return <div className="p-8" aria-busy="true"><Skeleton className="h-10 w-64" /><Skeleton className="mt-6 h-64 w-full" /></div>;
  if (!me) return null;
  if (!me.is_staff_user || perms.error) {
    const forbidden = !me.is_staff_user || (perms.error as any)?.status === 403;
    return forbidden
      ? <div className="mx-auto max-w-lg p-8"><EmptyState title="This area is for staff" action={<Button onClick={() => router.push("/")}>Back to the shop</Button>}>Your account doesn&apos;t have access to the staff dashboard. If you think it should, ask an administrator.</EmptyState></div>
      : <ErrorState error={perms.error} onRetry={() => perms.refetch()} />;
  }
  return <AdminProvider perms={perms.data!}><Frame>{children}</Frame></AdminProvider>;
}

/** Wrap a page that needs a capability; shows a clear message instead of an empty screen when it's missing. */
export function RequireCapability({ any, children }: { any: string[]; children: React.ReactNode }) {
  const { canAny } = useAdmin();
  if (!canAny(...any)) return <EmptyState title="You don't have access to this page">Your role doesn&apos;t include this area. If you need it, ask an administrator to change your role.</EmptyState>;
  return <>{children}</>;
}

"use client";

import { Heart, ListChecks, LogOut, MapPin, Package, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { useAuthActions, useMe } from "@/lib/hooks";
import { loginHref } from "@/lib/safe-next";

const NAV = [
  { href: "/account", label: "Overview", icon: UserRound, exact: true },
  { href: "/account/orders", label: "Orders", icon: Package },
  { href: "/account/addresses", label: "Addresses", icon: MapPin },
  { href: "/account/favorites", label: "Favourites", icon: Heart },
  { href: "/account/lists", label: "Shopping lists", icon: ListChecks },
] as const;

function ShellSkeleton() {
  return (
    <div className="container-x py-8 sm:py-10" aria-busy="true" aria-label="Loading your account">
      <Skeleton className="h-5 w-56" />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <Skeleton className="h-12 w-full lg:h-56" />
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps every signed-in page. The session lives in an HttpOnly cookie that only the browser sends, so the check is
 * client-side: visitors who aren't signed in are sent to /login and come back to the page they asked for.
 */
export function AccountShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: me, isError, refetch, error } = useMe();
  const { logout } = useAuthActions();
  const signingOut = React.useRef(false);
  const navRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (me === null && !signingOut.current) router.replace(loginHref(pathname + window.location.search));
  }, [me, pathname, router]);

  // On narrow screens the tabs scroll sideways; make sure the current one is in view.
  React.useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname, me]);

  if (isError && me === undefined) return <div className="container-x py-10"><ErrorState error={error} onRetry={() => refetch()} title="We couldn't check your sign-in" /></div>;
  if (me === undefined) return <ShellSkeleton />;
  if (me === null) {
    return (
      <div className="container-x py-16 text-center" role="status">
        <p className="text-ink-2">Taking you to sign in…</p>
        <p className="mt-2 text-sm"><Link href={loginHref(pathname)} className="font-semibold text-primary underline">Continue to sign in</Link></p>
      </div>
    );
  }

  const signOut = () => {
    signingOut.current = true;
    logout.mutate(undefined, { onSuccess: () => router.push("/"), onError: () => { signingOut.current = false; } });
  };

  return (
    <div className="container-x py-8 sm:py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="eyebrow">My account</p>
          <p className="truncate text-sm text-ink-2">Signed in as <span className="font-semibold text-ink">{me.email}</span></p>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut} loading={logout.isPending}><LogOut className="size-4" aria-hidden /> Sign out</Button>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <nav ref={navRef} aria-label="Account" className="-mx-4 overflow-x-auto border-b border-line px-4 [scrollbar-width:thin] sm:-mx-6 sm:px-6 lg:mx-0 lg:self-start lg:overflow-visible lg:border-b-0 lg:px-0">
          <ul className="flex gap-1 lg:flex-col">
            {NAV.map((item) => {
              const exact = "exact" in item && item.exact;
              const active = exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-3 text-[0.95rem] font-semibold transition-colors focus-visible:outline-offset-[-3px] lg:mb-0 lg:rounded-md lg:border-b-0 lg:py-2.5",
                      active ? "border-accent text-primary lg:bg-primary-soft" : "border-transparent text-ink-2 hover:text-primary lg:hover:bg-paper-2",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden /> {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

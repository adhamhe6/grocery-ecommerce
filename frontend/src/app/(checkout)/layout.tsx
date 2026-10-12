import { Lock } from "lucide-react";
import Link from "next/link";
import { DemoBar } from "@/components/layout/demo-bar";
import { Logo } from "@/components/layout/logo";
import { getStore } from "@/lib/server";

/** Distraction-free layout: no navigation, no footer links — just the way back to the basket. */
export default async function CheckoutLayout({ children }: { children: React.ReactNode }) {
  const store = await getStore();
  return (
    <>
      <DemoBar />
      <header className="border-b border-line bg-paper">
        <div className="container-x flex h-16 items-center justify-between">
          <Logo name={store.name} logoUrl={store.logo} />
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink-2"><Lock className="size-4" aria-hidden /> Checkout</p>
          <Link href="/cart" className="text-sm font-semibold text-primary hover:underline">Back to basket</Link>
        </div>
      </header>
      <main id="main" className="min-h-[70vh]">{children}</main>
    </>
  );
}

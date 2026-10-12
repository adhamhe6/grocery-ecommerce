import { cookies } from "next/headers";
import { CartDrawer } from "@/components/layout/cart-drawer";
import { BranchPicker } from "@/components/layout/branch-picker";
import { DemoBar } from "@/components/layout/demo-bar";
import { SiteFooter } from "@/components/layout/footer";
import { SiteHeader } from "@/components/layout/header";
import { getStore, serverGet } from "@/lib/server";
import type { CategoryNode } from "@/lib/types";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [store, departments] = await Promise.all([getStore(), serverGet<CategoryNode[]>("/categories/", undefined, { revalidate: 120, tags: ["categories"] })]);
  const jar = await cookies();
  const branch = Number(jar.get("gc_branch")?.value) || undefined;
  return (
    <>
      <DemoBar />
      <div className="border-b border-line bg-paper-2"><div className="container-x flex h-9 items-center justify-between"><BranchPicker current={branch} /><p className="hidden text-[0.8rem] text-ink-3 sm:block">{store.contact.hours}</p></div></div>
      <SiteHeader departments={departments} logoUrl={store.logo} />
      <main id="main" className="min-h-[60vh]">{children}</main>
      <SiteFooter store={store} />
      <CartDrawer />
    </>
  );
}

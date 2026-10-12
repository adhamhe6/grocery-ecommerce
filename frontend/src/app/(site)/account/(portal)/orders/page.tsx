import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersView } from "@/components/account/orders-view";
import { Skeleton } from "@/components/ui/states";

export const metadata: Metadata = { title: "Your orders" };

export default function AccountOrdersPage() {
  return (
    <Suspense fallback={<div aria-busy="true" aria-label="Loading your orders" className="space-y-3"><Skeleton className="h-10 w-56" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>}>
      <OrdersView />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { OrdersListPage } from "@/components/admin/orders/orders-list";

export const metadata: Metadata = { title: "Orders" };

export default function AdminOrdersPage() {
  return <Suspense><OrdersListPage /></Suspense>;
}

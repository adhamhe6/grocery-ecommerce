import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomersListPage } from "@/components/admin/orders/customers-list";

export const metadata: Metadata = { title: "Customers" };

export default function AdminCustomersPage() {
  return <Suspense><CustomersListPage /></Suspense>;
}

import type { Metadata } from "next";
import { CustomerDetailPage } from "@/components/admin/orders/customer-detail";

export const metadata: Metadata = { title: "Customer" };

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerDetailPage id={id} />;
}

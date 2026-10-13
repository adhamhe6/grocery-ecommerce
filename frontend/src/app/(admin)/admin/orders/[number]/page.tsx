import type { Metadata } from "next";
import { OrderDetailPage } from "@/components/admin/orders/order-detail";

export const metadata: Metadata = { title: "Order" };

export default async function AdminOrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return <OrderDetailPage number={decodeURIComponent(number)} />;
}

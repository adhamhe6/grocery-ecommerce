import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PurchaseOrderDetail } from "@/components/admin/purchasing/po-detail";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <PurchaseOrderDetail id={Number(id)} />;
}

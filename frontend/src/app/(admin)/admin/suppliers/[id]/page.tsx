import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupplierDetail } from "@/components/admin/purchasing/supplier-detail";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <SupplierDetail id={Number(id)} />;
}

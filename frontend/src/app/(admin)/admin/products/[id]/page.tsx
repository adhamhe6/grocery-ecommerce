import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductEditor } from "@/components/admin/catalog/product-editor";
import { RequireCapability } from "@/components/admin/shell";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) notFound();
  return <RequireCapability any={["catalog.read"]}><ProductEditor key={n} productId={n} /></RequireCapability>;
}

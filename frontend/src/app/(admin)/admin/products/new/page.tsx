import type { Metadata } from "next";
import { ProductEditor } from "@/components/admin/catalog/product-editor";
import { RequireCapability } from "@/components/admin/shell";

export const metadata: Metadata = { title: "New product" };

export default function NewProductPage() {
  return <RequireCapability any={["catalog.write"]}><ProductEditor /></RequireCapability>;
}

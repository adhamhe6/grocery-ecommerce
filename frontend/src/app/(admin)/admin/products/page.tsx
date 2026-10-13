import type { Metadata } from "next";
import { ProductList } from "@/components/admin/catalog/product-list";
import { RequireCapability } from "@/components/admin/shell";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return <RequireCapability any={["catalog.read"]}><ProductList /></RequireCapability>;
}

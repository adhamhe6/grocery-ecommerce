import type { Metadata } from "next";
import { SuppliersList } from "@/components/admin/purchasing/suppliers-list";

export const metadata: Metadata = { title: "Suppliers" };

export default function SuppliersPage() {
  return <SuppliersList />;
}

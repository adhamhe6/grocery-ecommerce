import type { Metadata } from "next";
import { PurchaseOrderList } from "@/components/admin/purchasing/po-list";

export const metadata: Metadata = { title: "Purchase orders" };

export default function PurchaseOrdersPage() {
  return <PurchaseOrderList />;
}

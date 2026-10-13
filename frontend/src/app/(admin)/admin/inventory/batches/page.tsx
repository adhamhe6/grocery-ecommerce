import type { Metadata } from "next";
import { BatchesPage } from "@/components/admin/inventory/batches-page";

export const metadata: Metadata = { title: "Batches and expiry" };

export default function BatchesRoute() {
  return <BatchesPage />;
}

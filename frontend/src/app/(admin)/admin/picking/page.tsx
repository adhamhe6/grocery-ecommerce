import type { Metadata } from "next";
import { Suspense } from "react";
import { PickingQueuePage } from "@/components/admin/orders/picking-queue";

export const metadata: Metadata = { title: "Picking queue" };

export default function AdminPickingPage() {
  return <Suspense><PickingQueuePage /></Suspense>;
}

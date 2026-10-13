import type { Metadata } from "next";
import { CaseDetailPage } from "@/components/admin/orders/case-detail";

export const metadata: Metadata = { title: "Support case" };

export default async function AdminCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseDetailPage id={id} />;
}

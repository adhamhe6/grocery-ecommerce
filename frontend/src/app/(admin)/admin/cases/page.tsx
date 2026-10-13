import type { Metadata } from "next";
import { Suspense } from "react";
import { CasesListPage } from "@/components/admin/orders/cases-list";

export const metadata: Metadata = { title: "Support cases" };

export default function AdminCasesPage() {
  return <Suspense><CasesListPage /></Suspense>;
}

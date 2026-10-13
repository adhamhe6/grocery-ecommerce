import type { Metadata } from "next";
import { ReportPage } from "@/components/admin/reports/report-page";

export const metadata: Metadata = { title: "Report" };

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <ReportPage name={name} />;
}

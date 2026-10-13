import type { Metadata } from "next";
import { PickSheetPage } from "@/components/admin/orders/pick-sheet";

export const metadata: Metadata = { title: "Pick sheet" };

export default async function AdminPickSheetPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return <PickSheetPage number={decodeURIComponent(number)} />;
}

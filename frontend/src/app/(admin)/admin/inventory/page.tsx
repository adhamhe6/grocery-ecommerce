import type { Metadata } from "next";
import { StockPage } from "@/components/admin/inventory/stock-page";

export const metadata: Metadata = { title: "Stock" };

export default async function StockRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const low = sp.low === "1" || sp.low === "true";
  // The key remounts the page when the dashboard link is followed while already on this screen.
  return <StockPage key={low ? "low" : "all"} low={low} />;
}

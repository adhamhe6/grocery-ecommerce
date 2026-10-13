import type { Metadata } from "next";
import { CompareView } from "@/components/compare/compare-view";

export const metadata: Metadata = {
  title: "Compare products",
  description: "Compare price, unit price, pack size, origin, allergens, nutrition and storage side by side.",
  robots: { index: false, follow: true }, // the list is personal to the shopper
};

export default function ComparePage() {
  return <CompareView />;
}

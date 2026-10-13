import type { Metadata } from "next";
import { DemoPayment } from "@/components/orders/demo-payment";

export const metadata: Metadata = { title: "Demonstration payment", robots: { index: false, follow: false } };

export default async function DemoPayPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <div className="container-x py-10"><DemoPayment reference={reference} /></div>;
}

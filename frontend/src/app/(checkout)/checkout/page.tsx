import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <div className="container-x py-8">
      <h1 className="text-3xl sm:text-4xl">Checkout</h1>
      <CheckoutView />
    </div>
  );
}

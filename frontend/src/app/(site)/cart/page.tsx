import type { Metadata } from "next";
import { CartView } from "@/components/cart/cart-view";

export const metadata: Metadata = { title: "Your basket", robots: { index: false } };

export default function CartPage() {
  return (
    <div className="container-x py-8">
      <h1 className="text-3xl sm:text-4xl">Your basket</h1>
      <CartView />
    </div>
  );
}

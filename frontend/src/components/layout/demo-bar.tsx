"use client";

import { useStore } from "@/lib/hooks";

/** Shown only while the store runs in demo mode so nobody mistakes sample data for a real shop. */
export function DemoBar() {
  const store = useStore();
  if (!store.demo_mode) return null;
  return (
    <div className="bg-ink text-center text-[0.8rem] text-white" role="note">
      <p className="container-x py-1.5">
        <strong className="font-semibold text-citrus">Demo store.</strong>{" "}
        Sample products, prices and stock. {store.payment.mode === "demo" ? "Card payments use a simulated sandbox — no real money moves." : ""}
      </p>
    </div>
  );
}

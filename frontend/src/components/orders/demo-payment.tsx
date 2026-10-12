"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError, api, apiGet } from "@/lib/api";
import { useMoney } from "@/lib/hooks";

interface DemoPaymentInfo { order_number: string; amount: string; currency: string; state: string; mode: string; notice: string }

/**
 * The demonstration "hosted payment page". It exists only while the demo adapter is enabled (the API returns 404 otherwise).
 * It never asks for card details and never moves money; choosing an outcome makes the backend deliver a *signed* event
 * through the same webhook path a real provider would use.
 */
export function DemoPayment({ reference }: { reference: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const token = useSearchParams().get("token");
  const money = useMoney();
  const info = useQuery({ queryKey: ["demo-payment", reference], queryFn: () => apiGet<DemoPaymentInfo>(`/payments/demo/${reference}/`), retry: false });
  const choose = useMutation({
    mutationFn: (outcome: "succeed" | "fail" | "cancel") => api<{ order_number: string; outcome: string }>(`/payments/demo/${reference}/`, { method: "POST", body: { outcome } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["order", r.order_number] });
      qc.invalidateQueries({ queryKey: ["cart"] });
      router.push(`/orders/${r.order_number}?${r.outcome === "succeed" ? "placed=1&" : ""}${token ? `token=${encodeURIComponent(token)}` : ""}`);
    },
  });
  if (info.isLoading) return <Skeleton className="mx-auto h-72 max-w-lg" />;
  if (info.error) return <ErrorState title={info.error instanceof ApiError && info.error.status === 404 ? "This payment page isn't available" : "We couldn't load the payment"} error={info.error} />;
  const d = info.data!;
  const settled = d.state !== "REQUIRES_ACTION";
  return (
    <div className="mx-auto max-w-lg rounded-lg border-2 border-dashed border-warn/50 bg-white p-6 shadow-card">
      <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-warn"><FlaskConical className="size-4" aria-hidden /> Demonstration payment — not a real payment</p>
      <h1 className="mt-3 text-3xl">Pay <span className="num">{money(d.amount)}</span></h1>
      <p className="mt-1 text-ink-2">Order <span className="num font-semibold">{d.order_number}</span></p>
      <Alert tone="info" className="mt-5" title="This page simulates a payment provider">{d.notice} No card details are collected here. Pick an outcome to see how the order reacts.</Alert>
      {settled ? (
        <Alert tone="warn" className="mt-5" title="This payment has already been handled">Its status is {d.state.replace(/_/g, " ").toLowerCase()}.</Alert>
      ) : (
        <div className="mt-6 grid gap-3">
          <Button size="lg" loading={choose.isPending && choose.variables === "succeed"} disabled={choose.isPending} onClick={() => choose.mutate("succeed")}>Simulate a successful payment</Button>
          <Button size="lg" variant="secondary" disabled={choose.isPending} onClick={() => choose.mutate("fail")}>Simulate a declined card</Button>
          <Button variant="ghost" disabled={choose.isPending} onClick={() => choose.mutate("cancel")}>Cancel and go back</Button>
        </div>
      )}
      {choose.error && <p role="alert" className="mt-4 text-sm font-medium text-bad">{choose.error instanceof ApiError ? choose.error.message : "That didn't work. Please try again."}</p>}
    </div>
  );
}

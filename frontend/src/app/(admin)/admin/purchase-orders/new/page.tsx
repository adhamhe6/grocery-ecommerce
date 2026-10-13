import type { Metadata } from "next";
import { NewPurchaseOrder } from "@/components/admin/purchasing/po-form";

export const metadata: Metadata = { title: "New purchase order" };

const id = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d+$/.test(s) ? Number(s) : undefined;
};

export default async function NewPurchaseOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <NewPurchaseOrder supplierId={id(sp.supplier)} branchId={id(sp.branch)} />;
}

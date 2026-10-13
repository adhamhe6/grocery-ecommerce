"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiGet, apiPatch } from "@/lib/api";
import type { Branch } from "@/lib/types";

/** Stock and slots are per store, so the chosen store is kept in a cookie the server components can read. */
export function setBranchCookie(id: number) {
  document.cookie = `gc_branch=${id}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
}

export function BranchPicker({ current }: { current?: number }) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["branches"], queryFn: () => apiGet<Branch[]>("/branches/"), staleTime: 5 * 60_000 });
  const branches = q.data ?? [];
  const active = branches.find((b) => b.id === current) ?? branches.find((b) => b.is_default) ?? branches[0];
  if (branches.length < 2) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex items-center gap-1.5 text-[0.8rem] font-medium text-ink-2 hover:text-primary" aria-label={`Shopping at ${active?.name}. Change store`}>
        <MapPin className="size-3.5" aria-hidden /> <span>Shopping at <strong className="font-semibold text-ink">{active?.name}</strong></span>
      </DialogTrigger>
      <DialogContent title="Choose your store" description="Availability and delivery slots are specific to each store.">
        <ul className="space-y-2">
          {branches.map((b) => (
            <li key={b.id}>
              <Button
                variant={b.id === active?.id ? "primary" : "secondary"} className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-3 text-left"
                onClick={async () => {
                  setBranchCookie(b.id);
                  // The basket is priced and checked against one store's stock, so it follows the choice.
                  await apiPatch("/cart/", { branch_id: b.id }).catch(() => undefined);
                  qc.invalidateQueries();
                  setOpen(false);
                  router.refresh();
                }}
              >
                <span>{b.name}</span><span className="text-xs font-normal opacity-80">{b.address}</span>
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

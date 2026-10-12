"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/field";

const OPTIONS: [string, string][] = [["relevance", "Recommended"], ["popular", "Most popular"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"], ["newest", "Newest"], ["offers", "Offers first"], ["name", "Name A–Z"]];

export function SortSelect({ current }: { current: string; hasQuery?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-semibold text-ink">Sort by</span>
      <Select className="h-10 w-auto min-w-44" value={current} onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        p.set("sort", e.target.value);
        p.delete("page");
        router.push(`${path}?${p.toString()}`);
      }}>
        {OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </label>
  );
}

import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div className="container-x py-10" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-10 w-72" />
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="aspect-[3/4] w-full" />)}</div>
    </div>
  );
}

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function Section({ title, eyebrow, href, hrefLabel = "See all", children, className }: { title: string; eyebrow?: string; href?: string; hrefLabel?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("container-x py-8 sm:py-10", className)} aria-label={title}>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h2 className="text-2xl sm:text-3xl">{title}</h2>
        </div>
        {href && <Link href={href} className="flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline">{hrefLabel}<ArrowRight className="size-4" aria-hidden /></Link>}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({ title, intro, eyebrow, children }: { title: string; intro?: React.ReactNode; eyebrow?: string; children?: React.ReactNode }) {
  return (
    <div className="border-b border-line bg-paper-2/60">
      <div className="container-x py-8 sm:py-10">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {intro && <div className="mt-2 max-w-2xl text-ink-2">{intro}</div>}
        {children}
      </div>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="container-x pt-4 text-sm text-ink-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2">
            {it.href ? <Link href={it.href} className="hover:text-primary hover:underline">{it.name}</Link> : <span aria-current="page" className="text-ink-2">{it.name}</span>}
            {i < items.length - 1 && <span aria-hidden>/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

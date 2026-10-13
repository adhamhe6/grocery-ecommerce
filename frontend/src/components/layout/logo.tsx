import Link from "next/link";
import { cn } from "@/lib/cn";

/** Wordmark + mark. The mark is three market "rows" with a leaf — original artwork, no third-party assets. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-9", className)} aria-hidden>
      <rect width="40" height="40" rx="10" fill="var(--color-primary)" />
      <path d="M9 17.5h22M9 23h22M9 28.5h22" stroke="#fbf7ef" strokeWidth="2.2" strokeLinecap="round" opacity=".9" />
      <path d="M22.5 7.5c5.8.3 9.2 3.7 9.5 9.5-5.8-.3-9.2-3.7-9.5-9.5Z" fill="var(--color-citrus)" />
      <path d="M22.5 7.5c2.6 2.2 5 4.6 9.5 9.5" stroke="var(--color-primary)" strokeWidth="1.1" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Logo({ name, logoUrl, className, light }: { name: string; logoUrl?: string | null; className?: string; light?: boolean }) {
  return (
    <Link href="/" className={cn("group inline-flex items-center gap-2.5", className)} aria-label={`${name} — home`}>
      {logoUrl ? <img src={logoUrl} alt="" className="h-9 w-auto" /> : <LogoMark />}
      <span className={cn("font-display text-[1.45rem] font-semibold leading-none tracking-tight", light ? "text-white" : "text-primary")}>{name}</span>
    </Link>
  );
}

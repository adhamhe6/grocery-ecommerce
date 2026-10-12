import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/cn";

const badge = cva("inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold leading-5", {
  variants: {
    tone: {
      neutral: "bg-paper-2 text-ink-2",
      primary: "bg-primary text-primary-fg",
      accent: "bg-accent text-white",
      ok: "bg-ok-soft text-ok",
      warn: "bg-warn-soft text-warn",
      bad: "bg-bad-soft text-bad",
      info: "bg-info-soft text-info",
      citrus: "bg-citrus text-ink",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}

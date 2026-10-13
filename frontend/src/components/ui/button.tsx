"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/cn";

export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:bg-primary-hover",
        accent: "bg-accent text-white hover:bg-accent-hover",
        secondary: "border border-line-strong bg-white text-primary hover:bg-paper-2",
        ghost: "text-primary hover:bg-primary-soft",
        danger: "bg-bad text-white hover:brightness-90",
        link: "text-primary underline underline-offset-4 hover:text-primary-hover px-0 h-auto font-medium",
      },
      size: { sm: "h-9 px-3 text-sm", md: "h-11 px-5 text-[0.95rem]", lg: "h-13 px-7 text-base", icon: "h-11 w-11", "icon-sm": "h-9 w-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(buttonStyles({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function ButtonLink({ className, variant, size, href, ...props }: React.ComponentProps<typeof Link> & VariantProps<typeof buttonStyles>) {
  return <Link href={href} className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

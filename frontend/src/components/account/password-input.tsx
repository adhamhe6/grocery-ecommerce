"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Accessible name of the reveal button. Make it specific when a page has several password fields. */
  toggleLabel?: string;
};

/** Password field with a show/hide button. The button is a real, labelled toggle (`aria-pressed`) reachable by keyboard. */
export const PasswordInput = React.forwardRef<HTMLInputElement, Props>(function PasswordInput({ className, toggleLabel = "Show password", ...props }, ref) {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={shown ? "text" : "password"} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={cn("pr-12", className)} {...props} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={toggleLabel}
        className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink"
      >
        {shown ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
      </button>
    </div>
  );
});

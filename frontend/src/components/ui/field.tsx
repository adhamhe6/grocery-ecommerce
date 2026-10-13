"use client";

import { AlertCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-md border border-line-strong bg-white px-3.5 text-[0.95rem] text-ink placeholder:text-ink-3 transition-colors focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 disabled:bg-paper-2 disabled:text-ink-3 aria-[invalid=true]:border-bad";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, "h-11", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-24 py-2.5", className)} {...props} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn(control, "h-11 appearance-none bg-[length:1rem] bg-[right_0.9rem_center] bg-no-repeat pr-9", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%234a524c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")" }} {...props}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Label + control + hint + error, wired with aria-describedby by the caller via `describedBy(id)`. */
export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">
        {label}
        {required && <span className="text-bad" aria-hidden> *</span>}
      </label>
      {children}
      {hint && !error && <p id={`${htmlFor}-hint`} className="text-sm text-ink-3">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-start gap-1.5 text-sm font-medium text-bad">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

export const describedBy = (id: string, hasHint?: boolean, hasError?: boolean) => (hasError ? `${id}-error` : hasHint ? `${id}-hint` : undefined);

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 text-[0.95rem]", className)}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded border-line-strong accent-[var(--color-primary)]" {...props} />
      <span>{label}</span>
    </label>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  title: string;
  description?: string;
  disabled?: boolean;
  badge?: string;
}

/** Radio group rendered as selectable rows. Keyboard accessible (native radios). */
export function ChoiceGroup<T extends string>({ name, legend, value, onChange, options, className }: { name: string; legend: string; value: T | ""; onChange: (v: T) => void; options: ChoiceOption<T>[]; className?: string }) {
  return (
    <fieldset className={cn("space-y-2", className)}>
      <legend className="mb-2 text-sm font-semibold text-ink">{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={cn("flex cursor-pointer items-start gap-3 rounded-md border bg-white p-3.5 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55", value === o.value ? "border-primary" : "border-line-strong")}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="mt-1 size-4 accent-[var(--color-primary)]" />
          <span className="flex-1">
            <span className="flex items-center gap-2 font-semibold text-ink">{o.title}{o.badge && <span className="rounded bg-citrus-soft px-1.5 py-0.5 text-xs font-semibold text-warn">{o.badge}</span>}</span>
            {o.description && <span className="mt-0.5 block text-sm text-ink-2">{o.description}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

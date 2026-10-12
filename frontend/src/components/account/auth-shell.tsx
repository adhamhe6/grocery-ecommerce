import * as React from "react";

/** Centered card used by sign-in, register and password-reset pages. Server-renderable. */
export function AuthShell({ title, intro, children, footer }: { title: string; intro?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="container-x py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {intro && <p className="mt-2 text-ink-2">{intro}</p>}
        <div className="mt-6 rounded-lg border border-line bg-white p-5 shadow-card sm:p-7">{children}</div>
        {footer && <div className="mt-5 space-y-1 text-center text-sm text-ink-2">{footer}</div>}
      </div>
    </div>
  );
}

"use client";

import * as RT from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "@/lib/cn";

export const Tabs = RT.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof RT.List>) {
  return <RT.List className={cn("flex gap-1 overflow-x-auto border-b border-line", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof RT.Trigger>) {
  return <RT.Trigger className={cn("-mb-px whitespace-nowrap border-b-2 border-transparent px-4 py-3 text-[0.95rem] font-semibold text-ink-2 transition-colors hover:text-primary data-[state=active]:border-accent data-[state=active]:text-primary", className)} {...props} />;
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof RT.Content>) {
  return <RT.Content className={cn("pt-6 focus:outline-none", className)} {...props} />;
}

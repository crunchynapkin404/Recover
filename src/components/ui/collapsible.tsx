"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function Collapsible({ className, ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      className={cn(className)}
      {...props}
    />
  );
}

function CollapsibleTrigger({
  className,
  badge,
  children,
  ...props
}: CollapsiblePrimitive.Trigger.Props & { badge?: React.ReactNode }) {
  return (
    <h3 className="contents">
      <CollapsiblePrimitive.Trigger
        data-slot="collapsible-trigger"
        className={cn(
          "glass group flex w-full items-center justify-between gap-3 rounded-2xl p-5 text-left",
          className
        )}
        {...props}
      >
        <span className="flex items-center gap-3">{children}</span>
        <span className="flex items-center gap-2">
          {badge}
          <ChevronDown
            aria-hidden
            className="size-4 text-white/40 transition-transform duration-300 group-data-[panel-open]:rotate-180"
          />
        </span>
      </CollapsiblePrimitive.Trigger>
    </h3>
  );
}

function CollapsiblePanel({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-panel"
      className={cn("collapsible-panel", className)}
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsiblePanel };

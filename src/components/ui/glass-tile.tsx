import * as React from "react";

import { cn } from "@/lib/utils";

interface GlassTileProps {
  /** Small uppercase caption above the value (rendered with .label-micro). */
  label: string;
  /** The primary value shown large (e.g. "65%", "88", "—"). */
  value: React.ReactNode;
  /**
   * Optional progress bar under the value. `value` is 0–100 (clamped);
   * `color` is any CSS color (defaults to emerald). Omit to render no bar.
   */
  bar?: { value: number; color?: string };
  /** Optional content below the value/bar — e.g. a sparkline. */
  children?: React.ReactNode;
  className?: string;
}

export function GlassTile({
  label,
  value,
  bar,
  children,
  className,
}: GlassTileProps) {
  return (
    <div className={cn("glass rounded-2xl p-4", className)}>
      <span className="label-micro mb-1 block">{label}</span>
      <span className="block text-xl font-bold text-white">{value}</span>
      {bar && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{
              width: `${Math.max(0, Math.min(100, bar.value))}%`,
              backgroundColor: bar.color ?? "#10b981",
            }}
          />
        </div>
      )}
      {children}
    </div>
  );
}

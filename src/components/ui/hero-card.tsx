import * as React from "react";

import { cn } from "@/lib/utils";

interface HeroCardProps {
  children: React.ReactNode;
  /** Ambient glow around the card. Default true. */
  glow?: boolean;
  /**
   * Glow color (any CSS color, ideally a translucent rgba). Lets the hero
   * glow track the readiness band. Defaults to a translucent emerald.
   */
  glowColor?: string;
  className?: string;
}

export function HeroCard({
  children,
  glow = true,
  glowColor,
  className,
}: HeroCardProps) {
  return (
    <div
      className={cn(
        "glass glass-no-hover relative flex flex-col items-center rounded-[2rem] px-6 py-8",
        className
      )}
      style={
        glow
          ? {
              boxShadow: `0 0 70px -18px ${glowColor ?? "rgba(16,185,129,0.5)"}`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

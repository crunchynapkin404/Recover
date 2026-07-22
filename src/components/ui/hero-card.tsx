import * as React from "react";

import { cn } from "@/lib/utils";

interface HeroCardProps {
  children: React.ReactNode;
  /** Ambient emerald glow shadow around the card. Default true. */
  glow?: boolean;
  className?: string;
}

export function HeroCard({ children, glow = true, className }: HeroCardProps) {
  return (
    <div
      className={cn(
        "glass glass-no-hover relative flex flex-col items-center rounded-[2rem] px-6 py-8",
        glow && "shadow-[0_8px_40px_-12px_rgba(16,185,129,0.25)]",
        className
      )}
    >
      {children}
    </div>
  );
}

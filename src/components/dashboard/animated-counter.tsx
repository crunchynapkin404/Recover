"use client";

import { useEffect, useRef } from "react";

interface Props {
  target: number;
  decimals?: number;
  duration?: number;
  className?: string;
}

/**
 * Animated count-up number. Counts from 0 to target with cubic ease-out.
 */
export function AnimatedCounter({
  target,
  decimals = 0,
  duration = 1500,
  className = "",
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const startTime = performance.now();

    function update(currentTime: number) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const current = easeProgress * target;
      el!.textContent = current.toFixed(decimals);
      if (progress < 1) requestAnimationFrame(update);
    }

    requestAnimationFrame(update);
  }, [target, decimals, duration]);

  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}

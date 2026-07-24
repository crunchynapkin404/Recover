"use client";

import { useEffect, useRef } from "react";

export const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const PAD = ((VISIBLE_ITEMS - 1) / 2) * ITEM_HEIGHT;
const SETTLE_MS = 120;

export function indexFromScrollTop(
  scrollTop: number,
  itemHeight: number,
  count: number
): number {
  const idx = Math.round(scrollTop / itemHeight);
  return Math.max(0, Math.min(count - 1, idx));
}

export function nearestIndex(options: number[], value: number): number {
  let best = 0;
  let bestDiff = Infinity;
  options.forEach((opt, i) => {
    const diff = Math.abs(opt - value);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

export function WheelColumn({
  options,
  value,
  onChange,
  disabled = false,
  label,
}: {
  options: number[];
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIdx = nearestIndex(options, value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const target = selectedIdx * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - target) > 2) {
      el.scrollTo({ top: target, behavior: "auto" });
    }
  }, [selectedIdx]);

  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  function handleScroll() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const idx = indexFromScrollTop(el.scrollTop, ITEM_HEIGHT, options.length);
      const next = options[idx];
      if (next !== value) onChange(next);
    }, SETTLE_MS);
  }

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      aria-disabled={disabled}
      onScroll={disabled ? undefined : handleScroll}
      className="hide-scrollbar h-[200px] w-16 snap-y snap-mandatory overflow-y-auto"
      style={{
        paddingTop: PAD,
        paddingBottom: PAD,
        pointerEvents: disabled ? "none" : "auto",
        opacity: disabled ? 0.3 : 1,
      }}
    >
      {options.map((opt, i) => (
        <div
          key={opt}
          role="option"
          aria-selected={i === selectedIdx}
          className="flex h-10 snap-center items-center justify-center text-[15px] font-bold text-white"
          onClick={() => {
            if (!disabled) onChange(opt);
          }}
        >
          {String(opt).padStart(2, "0")}
        </div>
      ))}
    </div>
  );
}

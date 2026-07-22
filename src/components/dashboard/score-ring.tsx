"use client";

import { useId } from "react";

import { AnimatedCounter } from "@/components/dashboard/animated-counter";

interface RingProps {
  value: number; // 0-100 or fractional for strain
  label: string;
  color: string; // CSS color (gradient start on lg)
  size: "sm" | "lg";
  /** Second gradient stop for the lg stroke — gives the ring a lit sheen. */
  colorEnd?: string;
  /** For strain-style display (e.g. "5.8") */
  displayValue?: string;
  /** No honest number to show yet — renders "—" on an empty track. */
  calibrating?: boolean;
}

export function ScoreRing({
  value,
  label,
  color,
  size,
  colorEnd,
  displayValue,
  calibrating,
}: RingProps) {
  const isSm = size === "sm";
  const r = isSm ? 42 : 44;
  const circumference = 2 * Math.PI * r;
  const shownValue = calibrating ? 0 : value;
  const offset = circumference - circumference * Math.min(shownValue / 100, 1);
  const strokeWidth = isSm ? 6 : 4.5;
  const svgSize = 100;
  const roundedValue = Math.round(value);
  const gradientId = useId();
  const useGradient = !isSm && !calibrating && !!colorEnd;
  const stroke = useGradient ? `url(#${gradientId})` : color;
  const ariaValue = calibrating
    ? "calibrating"
    : `${displayValue ?? roundedValue}${displayValue ? "" : " out of 100"}`;
  // The large ring counts its number up on load; small rings and the strain
  // display-value stay static. The animated node is aria-hidden, so screen
  // readers still read the real value once via the role="img" aria-label.
  const animate = !isSm && !calibrating && displayValue === undefined;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        role="img"
        aria-label={`${label}: ${ariaValue}`}
        className={`relative ${isSm ? "h-20 w-20" : "h-44 w-44"}`}
      >
        {/* Glow for large ring */}
        {!isSm && (
          <div
            className="hero-pulse absolute inset-0 rounded-full blur-3xl"
            style={{ background: `${color}20` }}
          />
        )}
        <svg
          aria-hidden
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          className="relative h-full w-full -rotate-90"
        >
          {useGradient && (
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={color} />
                <stop offset="1" stopColor={colorEnd} />
              </linearGradient>
            </defs>
          )}
          {/* Track */}
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={strokeWidth}
          />
          {/* Progress */}
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ "--target-offset": offset } as React.CSSProperties}
            className="ring-animate"
          />
        </svg>
        {/* Center text — redundant with the aria-label above; hidden from
            the accessibility tree so screen readers announce the role="img"
            name once instead of also reading these visual-only nodes. */}
        <div
          aria-hidden
          className={`absolute inset-0 flex flex-col items-center justify-center`}
        >
          <span
            className={`font-bold ${calibrating ? "text-white/40" : "text-white"} ${isSm ? "text-xl" : "text-6xl tracking-tighter"}`}
          >
            {calibrating ? (
              "—"
            ) : animate ? (
              <AnimatedCounter target={roundedValue} />
            ) : (
              (displayValue ?? roundedValue)
            )}
          </span>
          {!isSm && (
            <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
              {label}
            </span>
          )}
        </div>
      </div>
      {isSm && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
          {label}
        </span>
      )}
    </div>
  );
}

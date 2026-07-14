"use client";

interface RingProps {
  value: number; // 0-100 or fractional for strain
  label: string;
  color: string; // CSS color
  size: "sm" | "lg";
  /** For strain-style display (e.g. "5.8") */
  displayValue?: string;
}

export function ScoreRing({
  value,
  label,
  color,
  size,
  displayValue,
}: RingProps) {
  const isSm = size === "sm";
  const r = isSm ? 42 : 44;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - circumference * Math.min(value / 100, 1);
  const strokeWidth = isSm ? 6 : 4.5;
  const svgSize = 100;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        role="img"
        aria-label={`${label}: ${displayValue ?? Math.round(value)}${displayValue ? "" : " out of 100"}`}
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
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          className="relative h-full w-full -rotate-90"
        >
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
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            style={{ "--target-offset": offset } as React.CSSProperties}
            className="ring-animate"
          />
        </svg>
        {/* Center text */}
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center`}
        >
          <span
            className={`font-bold text-white ${isSm ? "text-xl" : "text-6xl tracking-tighter"}`}
          >
            {displayValue ?? Math.round(value)}
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

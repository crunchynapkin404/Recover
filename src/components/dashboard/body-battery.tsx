"use client";

interface Props {
  /** Current battery percentage 0-100 */
  current: number;
  /** SVG path for the energy curve (full day) */
  curvePath?: string;
}

/**
 * Garmin-style body battery curve showing energy levels through the day.
 * Uses a placeholder curve shape when no intraday data is available.
 */
export function BodyBatteryCurve({ current, curvePath }: Props) {
  const path =
    curvePath ??
    "M0 40 Q50 30 80 45 L120 120 L160 140 Q200 130 250 110 L300 80 L400 90";
  const fillPath = `${path} L400 180 L0 180 Z`;

  return (
    <div className="glass rounded-[2rem] p-7 overflow-hidden">
      <div className="mb-6 flex items-center justify-between">
        <span className="label-micro">Body Battery Curve</span>
        <span className="text-xs font-bold text-white/80">
          {current}% currently
        </span>
      </div>
      <div className="relative h-[180px] w-full">
        <svg
          viewBox="0 0 400 180"
          preserveAspectRatio="none"
          className="clip-reveal h-full w-full"
        >
          <defs>
            <linearGradient id="energy-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={path}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d={fillPath} fill="url(#energy-grad)" />
        </svg>
      </div>
      <div className="mt-4 flex justify-between text-[10px] font-bold uppercase tracking-widest text-white/50">
        <span>12 AM</span>
        <span>6 AM</span>
        <span>12 PM</span>
        <span>6 PM</span>
        <span>NOW</span>
      </div>
    </div>
  );
}

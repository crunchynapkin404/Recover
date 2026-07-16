"use client";

import type { BatteryPoint } from "@/lib/body-battery";

interface Props {
  /** Current charge 0-100, or null when there is not enough data. */
  current: number | null;
  /** The modelled curve. Empty when current is null. */
  points: BatteryPoint[];
}

const VIEW_W = 400;
const VIEW_H = 180;
const MINUTES_PER_DAY = 1440;

function toPath(points: BatteryPoint[]): string {
  return points
    .map((p, i) => {
      const x = (p.minutes / MINUTES_PER_DAY) * VIEW_W;
      const y = VIEW_H - (p.charge / 100) * VIEW_H;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Estimated energy through the day — a labelled model, not a measurement.
 * Renders nothing rather than inventing a curve when readiness is unavailable.
 */
export function BodyBatteryCurve({ current, points }: Props) {
  if (current == null || points.length === 0) {
    return (
      <div className="glass rounded-[2rem] p-7">
        <span className="label-micro">Estimated Energy</span>
        <p className="mt-4 text-sm text-white/50">
          Not enough data yet — your readiness score needs more history before
          energy can be estimated.
        </p>
      </div>
    );
  }

  const path = toPath(points);
  const lastX = ((points.at(-1)?.minutes ?? 0) / MINUTES_PER_DAY) * VIEW_W;
  const fillPath = `${path} L${lastX.toFixed(1)} ${VIEW_H} L0 ${VIEW_H} Z`;

  return (
    <div className="glass rounded-[2rem] p-7 overflow-hidden">
      <div className="mb-1 flex items-center justify-between">
        <span className="label-micro">Estimated Energy</span>
        <span className="text-xs font-bold text-white/80">{current}% now</span>
      </div>
      <p className="mb-6 text-[11px] text-white/40">
        Modelled from readiness and training load
      </p>
      <div className="relative h-[180px] w-full">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
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
        <span>12 AM</span>
      </div>
    </div>
  );
}

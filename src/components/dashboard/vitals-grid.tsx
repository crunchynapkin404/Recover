"use client";

import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { CHART_TOKENS } from "@/lib/charts";

interface VitalTile {
  label: string;
  value: string;
  unit: string;
  avg7d: string | null;
  trend: "up" | "down" | "flat";
  trendGood: boolean; // true = green, false = red
  sparkPath: string; // SVG path for sparkline
  sparkColor: string;
}

interface Props {
  tiles: VitalTile[];
}

const TrendIcon = ({
  trend,
  good,
}: {
  trend: "up" | "down" | "flat";
  good: boolean;
}) => {
  const color = good ? "text-emerald-400" : "text-red-400";
  if (trend === "up")
    return <ArrowUp className={`trend-arrow-animate size-3.5 ${color}`} />;
  if (trend === "down")
    return <ArrowDown className={`trend-arrow-animate size-3.5 ${color}`} />;
  return <Minus className="size-3.5 text-white/50" />;
};

export function VitalsGrid({ tiles }: Props) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {tiles.map((t) => (
        <div key={t.label} className="glass rounded-2xl p-5">
          <span className="mb-3 block text-[10px] font-bold uppercase tracking-widest text-white/50">
            {t.label}
          </span>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-white">{t.value}</span>
            <span className="ml-1 text-xs font-normal text-white/50">
              {t.unit}
            </span>
            <TrendIcon trend={t.trend} good={t.trendGood} />
          </div>
          {t.avg7d && (
            <p className="mb-3 text-[10px] text-white/50">7d avg: {t.avg7d}</p>
          )}
          <div className="sparkline-animate h-8">
            {/* An empty path means "not enough data for a trend" — render no
                chart at all rather than an SVG with an empty stroke. */}
            {t.sparkPath && (
              <svg
                viewBox="0 0 100 20"
                className="h-full w-full opacity-40"
                preserveAspectRatio="none"
              >
                <path
                  d={t.sparkPath}
                  fill="none"
                  stroke={t.sparkColor}
                  strokeWidth={CHART_TOKENS.strokeWidth.spark}
                />
              </svg>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

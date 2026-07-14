import { baselineBandLinear, baselineBandLn, rollingAvg } from "@/lib/charts";

interface WellnessDay {
  date: string;
  hrvMs: number | null;
  restingHr: number | null;
  sleepSecs: number | null;
  sleepScore: number | null;
}

interface Baselines {
  hrvLnMean: number | null;
  hrvLnSd: number | null;
  rhrMean: number | null;
  rhrSd: number | null;
}

function TrendChart({
  title,
  color,
  values,
  band,
  unit,
  bandLabel,
}: {
  title: string;
  color: string;
  values: (number | null)[];
  band: { low: number; high: number } | null;
  unit: string;
  bandLabel?: string;
}) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2)
    return (
      <div className="glass rounded-[2rem] p-6">
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="py-6 text-center text-sm text-white/40">
          Not enough data in this range.
        </p>
      </div>
    );
  const avg = rollingAvg(values, 7);
  const all = [...nums, ...(band ? [band.low, band.high] : [])];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const y = (v: number) => 38 - ((v - min) / range) * 34;
  const line = (vals: (number | null)[]) =>
    vals
      .map((v, i) =>
        v == null
          ? null
          : `${((i / (vals.length - 1)) * 100).toFixed(1)},${y(v).toFixed(1)}`
      )
      .filter(Boolean)
      .join(" ");
  const latest = [...nums].pop()!;

  return (
    <div className="glass rounded-[2rem] p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-bold">{title}</h3>
        <span className="text-sm font-bold" style={{ color }}>
          {Math.round(latest * 10) / 10} {unit}
        </span>
      </div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-28 w-full"
        role="img"
        aria-label={`${title} trend, latest ${Math.round(latest)} ${unit}`}
      >
        {band && (
          <rect
            x="0"
            y={y(band.high)}
            width="100"
            height={Math.max(y(band.low) - y(band.high), 0.5)}
            fill="rgba(255,255,255,0.06)"
          />
        )}
        <polyline
          points={line(values)}
          fill="none"
          stroke={color}
          strokeWidth="0.4"
          opacity="0.5"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line(avg)}
          fill="none"
          stroke={color}
          strokeWidth="0.9"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {band && (
        <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
          {bandLabel ?? "Band: your 60-day baseline ± 1 SD"}
        </p>
      )}
    </div>
  );
}

export function WellnessTrends({
  wellness,
  baselines,
}: {
  wellness: WellnessDay[];
  baselines: Baselines | null;
}) {
  const hrvBand =
    baselines?.hrvLnMean != null && baselines?.hrvLnSd != null
      ? baselineBandLn(baselines.hrvLnMean, baselines.hrvLnSd)
      : null;
  const rhrBand =
    baselines?.rhrMean != null && baselines?.rhrSd != null
      ? baselineBandLinear(baselines.rhrMean, baselines.rhrSd)
      : null;
  const sleepH = wellness.map((w) =>
    w.sleepSecs != null ? w.sleepSecs / 3600 : null
  );

  return (
    <div className="space-y-4">
      <TrendChart
        title="HRV"
        color="#34d399"
        unit="ms"
        values={wellness.map((w) => w.hrvMs)}
        band={hrvBand}
      />
      <TrendChart
        title="Resting HR"
        color="#f87171"
        unit="bpm"
        values={wellness.map((w) => w.restingHr)}
        band={rhrBand}
      />
      <TrendChart
        title="Sleep"
        color="#818cf8"
        unit="h"
        values={sleepH}
        band={{ low: 7, high: 9 }}
        bandLabel="Band: 7–9 h target"
      />
    </div>
  );
}

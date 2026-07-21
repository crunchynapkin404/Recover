import {
  baselineBandLinear,
  baselineBandLn,
  downsample,
  rollingAvg,
  CHART_TOKENS,
  formatChartValue,
} from "@/lib/charts";

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
          {formatChartValue(latest, 1)} {unit}
        </span>
      </div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-28 w-full"
        role="img"
        aria-label={`${title} trend, latest ${formatChartValue(latest)} ${unit}`}
      >
        {band && (
          <rect
            x="0"
            y={y(band.high)}
            width="100"
            height={Math.max(y(band.low) - y(band.high), 0.5)}
            fill={CHART_TOKENS.band}
          />
        )}
        <polyline
          points={line(values)}
          fill="none"
          stroke={color}
          strokeWidth={CHART_TOKENS.strokeWidth.thin}
          opacity="0.5"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line(avg)}
          fill="none"
          stroke={color}
          strokeWidth={CHART_TOKENS.strokeWidth.bold}
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

/** Sleep per spec: duration bars, sleep-score line, dashed 8 h guide. */
function SleepChart({ wellness }: { wellness: WellnessDay[] }) {
  const rawDur = wellness.map((w) =>
    w.sleepSecs != null ? w.sleepSecs / 3600 : null
  );
  const rawScore = wellness.map((w) => w.sleepScore);
  // Long ranges: bucket-mean down to ~120 bars so they stay visible.
  const dur = rawDur.length > 120 ? downsample(rawDur, 120) : rawDur;
  const score = rawScore.length > 120 ? downsample(rawScore, 120) : rawScore;
  const nums = dur.filter((v): v is number => v != null);
  if (nums.length < 2)
    return (
      <div className="glass rounded-[2rem] p-6">
        <h3 className="text-sm font-bold">Sleep</h3>
        <p className="py-6 text-center text-sm text-white/40">
          Not enough data in this range.
        </p>
      </div>
    );

  const maxH = Math.max(9, ...nums);
  const n = dur.length;
  const barW = 100 / n;
  const yDur = (h: number) => 38 - (h / maxH) * 34;
  const yScore = (s: number) => 38 - (s / 100) * 34;
  const scoreLine = score
    .map((s, i) =>
      s == null
        ? null
        : `${(i * barW + barW / 2).toFixed(2)},${yScore(s).toFixed(2)}`
    )
    .filter(Boolean)
    .join(" ");
  const latest = [...nums].pop()!;

  return (
    <div className="glass rounded-[2rem] p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-bold">Sleep</h3>
        <span
          className="text-sm font-bold"
          style={{ color: CHART_TOKENS.series[8] /* indigo-400 */ }}
        >
          {formatChartValue(latest, 1)} h
        </span>
      </div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-28 w-full"
        role="img"
        aria-label={`Sleep trend, latest ${formatChartValue(latest, 1)} hours`}
      >
        {dur.map((h, i) =>
          h == null ? null : (
            <rect
              key={i}
              x={(i * barW + barW * 0.15).toFixed(2)}
              y={yDur(h).toFixed(2)}
              width={(barW * 0.7).toFixed(2)}
              height={(38 - yDur(h)).toFixed(2)}
              fill={CHART_TOKENS.series[8] /* indigo-400 */}
              opacity="0.55"
            />
          )
        )}
        <line
          x1="0"
          y1={yDur(8).toFixed(2)}
          x2="100"
          y2={yDur(8).toFixed(2)}
          stroke={CHART_TOKENS.grid}
          strokeWidth={CHART_TOKENS.strokeWidth.hairline}
          strokeDasharray={CHART_TOKENS.dash}
        />
        {scoreLine && (
          <polyline
            points={scoreLine}
            fill="none"
            stroke={CHART_TOKENS.series[9] /* gray-200, neutral overlay */}
            strokeWidth={CHART_TOKENS.strokeWidth.overlay}
            opacity="0.8"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
        Bars: duration · Line: sleep score · Dashed: 8 h
      </p>
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
  return (
    <div className="space-y-4">
      <TrendChart
        title="HRV"
        color={CHART_TOKENS.series[2] /* emerald-400 */}
        unit="ms"
        values={wellness.map((w) => w.hrvMs)}
        band={hrvBand}
      />
      <TrendChart
        title="Resting HR"
        color={CHART_TOKENS.series[5] /* red-400 */}
        unit="bpm"
        values={wellness.map((w) => w.restingHr)}
        band={rhrBand}
      />
      <SleepChart wellness={wellness} />
    </div>
  );
}

interface Day {
  date: string;
  ctl: number | null;
  atl: number | null;
}

function polyline(
  values: (number | null)[],
  min: number,
  range: number
): string {
  const pts: string[] = [];
  const n = values.length;
  values.forEach((v, i) => {
    if (v == null) return;
    const x = n > 1 ? (i / (n - 1)) * 100 : 0;
    const y = 38 - ((v - min) / range) * 34;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  return pts.join(" ");
}

/**
 * CTL (solid blue), ATL (dashed red), TSB (emerald area vs zero line).
 *
 * `showStats` prints today's three values under the chart. Train's Fitness
 * segment turns it off because its stat tiles above the chart already carry
 * those exact numbers — the same value twice on one screen is clutter.
 */
export function PmcChart({
  wellness,
  showStats = true,
}: {
  wellness: Day[];
  showStats?: boolean;
}) {
  const ctl = wellness.map((w) => w.ctl);
  const atl = wellness.map((w) => w.atl);
  const tsb = wellness.map((w) =>
    w.ctl != null && w.atl != null ? w.ctl - w.atl : null
  );
  const nums = [...ctl, ...atl, ...tsb].filter((v): v is number => v != null);
  if (nums.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-white/40">
        Not enough data yet for this range.
      </p>
    );
  }
  const min = Math.min(...nums, 0);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const zeroY = 38 - ((0 - min) / range) * 34;

  const n = tsb.length;
  const area: string[] = [];
  tsb.forEach((v, i) => {
    if (v == null) return;
    const x = n > 1 ? (i / (n - 1)) * 100 : 0;
    const y = 38 - ((v - min) / range) * 34;
    area.push(
      `${area.length === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
    );
  });
  const areaPath =
    area.length > 1
      ? `${area.join(" ")} L100 ${zeroY.toFixed(1)} L0 ${zeroY.toFixed(1)} Z`
      : "";

  const latest = [...wellness]
    .reverse()
    .find((w) => w.ctl != null && w.atl != null);
  const latestTsb =
    latest?.ctl != null && latest?.atl != null ? latest.ctl - latest.atl : null;

  return (
    <div>
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label="Performance management chart: fitness, fatigue, and form over time"
      >
        {areaPath && <path d={areaPath} fill="#34d399" opacity="0.12" />}
        <line
          x1="0"
          y1={zeroY}
          x2="100"
          y2={zeroY}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="0.3"
          strokeDasharray="1 1"
        />
        <polyline
          points={polyline(ctl, min, range)}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="0.7"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={polyline(atl, min, range)}
          fill="none"
          stroke="#ef4444"
          strokeWidth="0.5"
          strokeDasharray="1.5 1"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {showStats && (
        <div className="mt-4 flex justify-around border-t border-white/5 pt-4 text-center">
          <Stat color="text-blue-400" label="CTL" value={latest?.ctl} />
          <Stat color="text-red-400" label="ATL" value={latest?.atl} />
          <Stat color="text-emerald-400" label="TSB" value={latestTsb} />
        </div>
      )}
    </div>
  );
}

function Stat({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="flex flex-col">
      <span className={`text-xl font-bold ${color}`}>
        {value != null ? Math.round(value) : "—"}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
        {label}
      </span>
    </div>
  );
}

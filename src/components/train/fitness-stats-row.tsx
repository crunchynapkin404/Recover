export interface FitnessStat {
  label: string;
  value: string;
}

interface Props {
  stats: FitnessStat[];
}

const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

/**
 * Coarse CTL ramp-rate trend label. A small dead zone around zero absorbs
 * day-to-day noise instead of flapping between Ramping/Tapering.
 */
export function rampTrendLabel(rampRate: number | null): string | null {
  if (rampRate == null) return null;
  if (rampRate > 1) return "Ramping ↑";
  if (rampRate < -1) return "Tapering ↓";
  return "Steady";
}

/**
 * eFTP / max power / W' / ramp-rate trend, next to the PMC chart that
 * computes them. Caller supplies only the stats with real values — there
 * is no zero or placeholder for a field the athlete's data doesn't have.
 */
export function FitnessStatsRow({ stats }: Props) {
  if (stats.length === 0) return null;
  return (
    <div className={`grid gap-2 ${GRID_COLS[stats.length]}`}>
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
            {s.label}
          </span>
          <span className="mt-1 text-sm font-bold tabular-nums text-white">
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

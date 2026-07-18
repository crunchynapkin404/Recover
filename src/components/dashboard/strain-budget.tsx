interface Props {
  used: number;
  total: number;
  /** No honest load numbers yet — renders the calibrating note, no bar. */
  calibrating?: boolean;
}

export function StrainBudget({ used, total, calibrating }: Props) {
  const remaining = Math.max(0, total - used);
  const pct = total > 0 ? (used / total) * 100 : 0;

  if (calibrating) {
    return (
      <div className="glass rounded-2xl p-5">
        <div className="mb-1 flex items-center justify-between">
          <span className="label-micro">Strain Budget</span>
          <span className="text-xs font-bold text-white/50">Calibrating</span>
        </div>
        <p className="text-xs text-white/50">
          Log workouts (or connect intervals.icu) and your strain budget will be
          sized from your own training load.
        </p>
      </div>
    );
  }

  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-micro">Strain Budget</span>
        <span className="text-xs font-bold text-white/80">
          {remaining.toFixed(1)} remaining{" "}
          <span className="font-normal text-white/50">
            of {total.toFixed(1)}
          </span>
        </span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="clip-reveal h-full bg-blue-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between px-1">
        <div className="h-1 w-1 rounded-full bg-emerald-500 opacity-50" />
        <div className="h-1 w-1 rounded-full bg-amber-500 opacity-50" />
        <div className="h-1 w-1 rounded-full bg-red-500 opacity-50" />
      </div>
    </div>
  );
}

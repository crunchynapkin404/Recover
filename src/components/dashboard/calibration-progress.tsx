interface Props {
  daysWithSignal: number;
  target: number;
  prompt: string;
}

/**
 * First-run calibrating state (v0.11): an honest "day N of 14" progress
 * bar with a next-step prompt, shown in place of a bare "calibrating"
 * label until readiness has enough history to score.
 */
export function CalibrationProgress({ daysWithSignal, target, prompt }: Props) {
  const pct = target > 0 ? Math.round((daysWithSignal / target) * 100) : 0;
  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="label-micro">Calibrating readiness</span>
        <span className="text-xs font-bold text-white/80">
          Day {daysWithSignal}{" "}
          <span className="font-normal text-white/50">of {target}</span>
        </span>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/5"
        role="progressbar"
        aria-valuenow={daysWithSignal}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-label="Readiness calibration progress"
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-white/70">{prompt}</p>
    </div>
  );
}

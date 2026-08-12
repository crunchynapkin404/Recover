interface Props {
  daysWithSignal: number;
  target: number;
  prompt: string;
}

/**
 * First-run calibrating state (v0.11): an honest "day N of 14" progress
 * bar with a next-step prompt, shown in place of a bare "calibrating"
 * label until readiness has enough history to score.
 *
 * v0.99 slice 1: on the token surface/ink/type scale. Glass is gone — it is
 * reserved for chrome that genuinely floats (nav pill, bottom sheets); a
 * block sitting in the page flow uses a real surface token.
 */
export function CalibrationProgress({ daysWithSignal, target, prompt }: Props) {
  const pct = target > 0 ? Math.round((daysWithSignal / target) * 100) : 0;
  return (
    <div className="rounded-[20px] glass glass-no-hover p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
          Calibrating readiness
        </span>
        <span className="text-label font-bold text-ink-primary">
          Day {daysWithSignal}{" "}
          <span className="font-normal text-ink-muted">of {target}</span>
        </span>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-overlay"
        role="progressbar"
        aria-valuenow={daysWithSignal}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-label="Readiness calibration progress"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-3 text-caption leading-relaxed text-ink-secondary">
        {prompt}
      </p>
    </div>
  );
}

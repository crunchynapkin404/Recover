interface SleepStage {
  label: string;
  pct: number;
  color: string;
}

interface Props {
  score: number;
  duration: string;
  efficiency: string;
  stages: SleepStage[];
  bedtimeAdvice: string | null;
}

export function SleepCard({
  score,
  duration,
  efficiency,
  stages,
  bedtimeAdvice,
}: Props) {
  return (
    <div className="glass rounded-[2rem] p-7">
      <div className="mb-6 flex items-center justify-between">
        <span className="label-micro">Last Night&apos;s Sleep</span>
        <span className="text-xs font-bold text-white/80">{score} Score</span>
      </div>

      {/* Stacked bar */}
      <div className="mb-6 flex h-5 w-full overflow-hidden rounded-full">
        {stages.map((s, i) => (
          <div
            key={s.label}
            className="clip-reveal h-full"
            style={{
              width: `${s.pct}%`,
              background: s.color,
              animationDelay: `${i * 100}ms`,
            }}
          />
        ))}
      </div>

      <div className="mb-8 grid grid-cols-2 gap-x-12 gap-y-6">
        <div>
          <p className="label-micro mb-1">Duration</p>
          <p className="text-xl font-bold text-white">{duration}</p>
        </div>
        <div>
          <p className="label-micro mb-1">Efficiency</p>
          <p className="text-xl font-bold text-white">{efficiency}</p>
        </div>
      </div>

      {bedtimeAdvice && (
        <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
          <p className="text-[12px] text-white/80">
            <span className="mr-2 text-indigo-400">🌙</span>
            Optimal bedtime tonight:{" "}
            <span className="font-bold text-indigo-400">{bedtimeAdvice}</span>
          </p>
        </div>
      )}
    </div>
  );
}

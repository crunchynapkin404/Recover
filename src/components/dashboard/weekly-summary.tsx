interface Props {
  workouts: number;
  totalVolume: string;
  avgLoad: string;
  streak: number;
  /** 0-1 fraction for outer ring (recovery) */
  ringOuter: number;
  /** 0-1 fraction for inner ring (strain) */
  ringInner: number;
}

export function WeeklySummary({
  workouts,
  totalVolume,
  avgLoad,
  streak,
  ringOuter,
  ringInner,
}: Props) {
  const outerC = 2 * Math.PI * 40;
  const innerC = 2 * Math.PI * 26;

  return (
    <div className="glass rounded-[2.5rem] p-7">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="label-micro">This Week</span>
          {streak > 0 && (
            <span className="mt-1 text-xs font-bold text-emerald-400">
              {streak}-day logging streak 🔥
            </span>
          )}
        </div>
        {/* Apple Watch style nested rings */}
        <div className="relative h-16 w-16">
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="rgba(16,185,129,0.1)"
              strokeWidth="12"
            />
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="#10b981"
              strokeWidth="12"
              strokeDasharray={outerC}
              strokeDashoffset={outerC * (1 - ringOuter)}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              className="ring-animate"
              style={
                {
                  "--target-offset": outerC * (1 - ringOuter),
                } as React.CSSProperties
              }
            />
            <circle
              cx="50"
              cy="50"
              r="26"
              fill="none"
              stroke="rgba(59,130,246,0.1)"
              strokeWidth="12"
            />
            <circle
              cx="50"
              cy="50"
              r="26"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="12"
              strokeDasharray={innerC}
              strokeDashoffset={innerC * (1 - ringInner)}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              className="ring-animate"
              style={
                {
                  "--target-offset": innerC * (1 - ringInner),
                } as React.CSSProperties
              }
            />
          </svg>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-y-6">
        <div className="flex flex-col">
          <span className="text-xl font-bold text-white">
            {workouts} Workouts
          </span>
          <span className="text-[10px] font-bold uppercase tracking-tight text-white/50">
            {totalVolume} Total volume
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xl font-bold text-white">{avgLoad} Load</span>
          <span className="text-[10px] font-bold uppercase tracking-tight text-white/50">
            Avg Training load
          </span>
        </div>
      </div>
    </div>
  );
}

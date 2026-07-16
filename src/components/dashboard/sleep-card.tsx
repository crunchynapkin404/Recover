import Link from "next/link";

interface Props {
  /** The provider's real 0-100 score, or null when it gave none. */
  score: number | null;
  duration: string;
  /** Cumulative deficit over the debt window; null = not enough data. */
  debtSecs: number | null;
  /** Computed bedtime target, or null when no wake time is set. */
  bedtimeAdvice: string | null;
  wakeTimeSet: boolean;
}

function formatDebt(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function SleepCard({
  score,
  duration,
  debtSecs,
  bedtimeAdvice,
  wakeTimeSet,
}: Props) {
  return (
    <div className="glass rounded-[2rem] p-7">
      <div className="mb-6 flex items-center justify-between">
        <span className="label-micro">Last Night&apos;s Sleep</span>
        <span className="text-xs font-bold text-white/80">
          {score != null ? `${Math.round(score)} Score` : "—"}
        </span>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-x-12 gap-y-6">
        <div>
          <p className="label-micro mb-1">Duration</p>
          <p className="text-xl font-bold text-white">{duration}</p>
        </div>
        <div>
          <p className="label-micro mb-1">Sleep debt</p>
          <p className="text-xl font-bold text-white">
            {debtSecs != null ? formatDebt(debtSecs) : "—"}
          </p>
          {debtSecs == null && (
            <p className="mt-1 text-[11px] text-white/40">
              Not enough sleep data yet
            </p>
          )}
        </div>
      </div>

      {bedtimeAdvice != null ? (
        <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
          <p className="text-[12px] text-white/80">
            <span className="mr-2 text-indigo-400">🌙</span>
            Target bedtime tonight:{" "}
            <span className="font-bold text-indigo-400">{bedtimeAdvice}</span>
          </p>
        </div>
      ) : (
        !wakeTimeSet && (
          <div className="rounded-2xl border border-white/5 bg-white/5 p-4">
            <p className="text-[12px] text-white/60">
              <span className="mr-2 text-indigo-400">🌙</span>
              Set your usual wake time in{" "}
              <Link href="/settings" className="font-bold text-indigo-400">
                Settings
              </Link>{" "}
              to get a bedtime target.
            </p>
          </div>
        )
      )}
    </div>
  );
}

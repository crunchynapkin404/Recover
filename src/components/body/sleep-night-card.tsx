export interface SleepStages {
  deepSecs: number;
  remSecs: number;
  lightSecs: number;
  awakeSecs: number;
}

interface Props {
  /** Total asleep time in seconds, or null when last night wasn't recorded. */
  totalSecs: number | null;
  /** Provider stage split; null when the provider doesn't send stages. */
  stages: SleepStages | null;
  /** Local "HH:MM" bed window, when the provider sent one. */
  bedWindow: { start: string; end: string } | null;
  consistency: number | null;
  chronotype: string | null;
  /** Recommended bedtime tonight ("23:10"), or null when unknown. */
  bedtimeTonight: string | null;
}

const STAGES = [
  { key: "deepSecs", label: "Deep", color: "#3b82f6" },
  { key: "remSecs", label: "REM", color: "#8b5cf6" },
  { key: "lightSecs", label: "Light", color: "rgba(59,130,246,0.35)" },
  { key: "awakeSecs", label: "Awake", color: "rgba(255,255,255,0.25)" },
] as const;

function clock(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Last night (1g) — the stage bar, its legend with real durations, and the
 * three things worth knowing about the athlete's sleep rhythm.
 *
 * intervals.icu sends no stages and no bed/wake times, so the bar and the
 * window simply don't render for those athletes rather than being estimated
 * from total sleep.
 */
export function SleepNightCard({
  totalSecs,
  stages,
  bedWindow,
  consistency,
  chronotype,
  bedtimeTonight,
}: Props) {
  const stageTotal = stages
    ? stages.deepSecs + stages.remSecs + stages.lightSecs + stages.awakeSecs
    : 0;

  const footer = [
    consistency != null
      ? { label: "Consistency", value: String(Math.round(consistency)) }
      : null,
    chronotype ? { label: "Chronotype", value: chronotype } : null,
  ].filter((f): f is { label: string; value: string } => f !== null);

  return (
    <section className="mb-3 rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-white/40">
          Last night{totalSecs != null && ` · ${clock(totalSecs)}`}
        </h3>
        {bedWindow && (
          <p className="font-mono text-[11px] text-white/45">
            {bedWindow.start} → {bedWindow.end}
          </p>
        )}
      </div>

      {stages && stageTotal > 0 ? (
        <>
          <div className="flex h-3.5 overflow-hidden rounded-[7px]">
            {STAGES.map((s) => {
              const secs = stages[s.key];
              if (secs <= 0) return null;
              return (
                <span
                  key={s.key}
                  aria-hidden
                  style={{
                    width: `${(secs / stageTotal) * 100}%`,
                    background: s.color,
                  }}
                />
              );
            })}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {STAGES.map((s) => {
              const secs = stages[s.key];
              if (secs <= 0) return null;
              return (
                <li
                  key={s.key}
                  className="flex items-center gap-1.5 text-[9.5px] text-white/60"
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ background: s.color }}
                  />
                  {s.label} {clock(secs)}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-[11px] text-white/40">
          {totalSecs != null
            ? "Your provider doesn't send sleep stages — total time only."
            : "No sleep recorded last night."}
        </p>
      )}

      {(footer.length > 0 || bedtimeTonight) && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-white/[0.06] pt-3">
          {footer.map((f) => (
            <span key={f.label} className="text-[11px] text-white/50">
              {f.label}{" "}
              <strong className="font-bold text-white/85">{f.value}</strong>
            </span>
          ))}
          {bedtimeTonight && (
            <span className="text-[11px] font-medium text-amber-400/90">
              Tonight: bed by {bedtimeTonight}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

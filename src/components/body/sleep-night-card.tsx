import Link from "next/link";

export interface SleepStages {
  deepSecs: number;
  remSecs: number;
  lightSecs: number;
  awakeSecs: number;
}

interface Props {
  /** Total asleep time in seconds, or null when the night wasn't recorded. */
  totalSecs: number | null;
  /** Provider stage split; null when this night has no stages. */
  stages: SleepStages | null;
  /** Local "HH:MM" bed window, when the provider sent one. */
  bedWindow: { start: string; end: string } | null;
  /** Heading for the night on screen, e.g. "Last night" or "Fri 31 Jul". */
  heading: string;
  /** Previous/next night hrefs; omitted at the ends of the history. */
  prevHref?: string;
  nextHref?: string;
  /**
   * True only when NO night in the window has stages — i.e. the provider
   * genuinely doesn't send them. False means this particular night is
   * missing them while siblings have them, which is the common case: the
   * Companion writes a night's duration before its stages.
   */
  stagesUnsupported: boolean;
  /**
   * Recommended bedtime tonight ("23:10"), or null. Only ever passed for the
   * latest night — advising a bedtime while viewing a night from last week
   * would be nonsense.
   */
  bedtimeTonight: string | null;
}

const STAGES = [
  { key: "deepSecs", label: "Deep", color: "var(--chart-1)" },
  { key: "remSecs", label: "REM", color: "var(--chart-4)" },
  { key: "lightSecs", label: "Light", color: "var(--chart-1)", dim: true },
  { key: "awakeSecs", label: "Awake", color: "var(--hairline)" },
] as const;

/**
 * "1:31". Rounds to whole minutes FIRST, then splits — computing hours and
 * minutes independently renders 3597s as "0:60", because the minute part
 * rounds up to 60 without carrying into the hour.
 */
function clock(secs: number): string {
  const totalMin = Math.round(secs / 60);
  return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, "0")}`;
}

/**
 * Last night (1g) — the stage bar, its legend with real durations, and the
 * three things worth knowing about the athlete's sleep rhythm.
 *
 * intervals.icu sends no bed/wake times, so the window simply doesn't render
 * rather than being estimated from total sleep. Stages DO arrive from it as
 * of v0.33, via custom wellness fields.
 *
 * Every stage with a zero duration is dropped from both the bar and the
 * legend. That is what keeps "Awake" off the intervals.icu route, where it is
 * always zero: that feed's sleep total is asleep time, not in-bed time, so
 * deep+REM+light sums to it exactly (verified 31/31 nights). Do NOT try to
 * derive awake as total-minus-stages — it yields a guaranteed 0 and would
 * assert a night with no awakenings as though it had been measured. Real
 * awake time needs an in-bed window, which only a direct HealthKit push has.
 */
export function SleepNightCard({
  totalSecs,
  stages,
  bedWindow,
  heading,
  prevHref,
  nextHref,
  stagesUnsupported,
  bedtimeTonight,
}: Props) {
  const stageTotal = stages
    ? stages.deepSecs + stages.remSecs + stages.lightSecs + stages.awakeSecs
    : 0;

  return (
    <section className="glass mb-3 rounded-[18px] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="label-micro flex items-baseline gap-2">
          {prevHref ? (
            <Link
              href={prevHref}
              aria-label="Previous night"
              className="text-caption leading-none text-ink-muted hover:text-ink-secondary"
            >
              ‹
            </Link>
          ) : (
            <span aria-hidden className="invisible text-caption leading-none">
              ‹
            </span>
          )}
          <span>
            {heading}
            {totalSecs != null && ` · ${clock(totalSecs)}`}
          </span>
          {nextHref ? (
            <Link
              href={nextHref}
              aria-label="Next night"
              className="text-caption leading-none text-ink-muted hover:text-ink-secondary"
            >
              ›
            </Link>
          ) : (
            <span aria-hidden className="invisible text-caption leading-none">
              ›
            </span>
          )}
        </h3>
        {bedWindow && (
          <p className="font-numeric text-label text-ink-muted">
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
              const dim = "dim" in s && s.dim;
              return (
                <span
                  key={s.key}
                  aria-hidden
                  className={dim ? "opacity-35" : undefined}
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
              const dim = "dim" in s && s.dim;
              return (
                <li
                  key={s.key}
                  className="text-label flex items-center gap-1.5 text-ink-secondary"
                >
                  <span
                    aria-hidden
                    className={`size-2 rounded-full ${dim ? "opacity-35" : ""}`}
                    style={{ background: s.color }}
                  />
                  {s.label} {clock(secs)}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-caption text-ink-muted">
          {totalSecs == null
            ? "No sleep recorded for this night."
            : stagesUnsupported
              ? "Your provider doesn't send sleep stages — total time only."
              : "No stages recorded for this night yet."}
        </p>
      )}

      {bedtimeTonight && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-hairline pt-3">
          <span className="text-caption font-medium text-chart-3">
            Tonight: bed by {bedtimeTonight}
          </span>
        </div>
      )}
    </section>
  );
}

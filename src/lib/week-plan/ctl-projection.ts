// CTL itself arrives from intervals.icu in wellnessDaily and is never
// recomputed here. This projects it forward, which is a different job.

/** Standard CTL time constant, in days. */
const CTL_TAU = 42;
/**
 * Below this much load history no verdict is honest enough to show.
 * Source: no design doc found citing this specific file/value — the
 * file's own reasoning is the only source. A data-sufficiency gate in the
 * same family as `readiness.ts`'s `MIN_BASELINE_DAYS` (14) and
 * `overtraining.ts`'s same-named-but-different-value `MIN_HISTORY_DAYS`
 * (21, a different domain). Confidence: Low.
 */
export const MIN_HISTORY_DAYS = 28;

/**
 * CTL after `days` days at an even daily share of `weekLoad`, using the
 * standard exponential smoothing. Load equal to CTL × 7 over a week holds
 * CTL flat, which is what makes "maintenance" a real number.
 */
export function projectCtl(
  currentCtl: number,
  weekLoad: number,
  days = 7
): number {
  const daily = weekLoad / 7;
  const alpha = 1 - Math.exp(-1 / CTL_TAU);
  let ctl = currentCtl;
  for (let i = 0; i < days; i++) ctl += (daily - ctl) * alpha;
  return ctl;
}

export interface VerdictInput {
  offeredMins: number;
  currentCtl: number | null;
  loadPerHour: number | null;
  historyDays: number;
  effectiveTarget: number;
}

export type Verdict =
  | { kind: "silent" }
  | { kind: "losing"; maintenanceHrs: number; projectedCtl: number }
  | { kind: "holding"; targetHrs: number }
  | { kind: "ok" };

/**
 * Is the offered time enough? Silent while calibrating — a fabricated
 * threshold during the first four weeks would be worse than saying
 * nothing.
 *
 * A zero or missing `effectiveTarget` is treated the same way: with no
 * real target, `targetHrs` collapses to 0 and any offered time at or
 * above maintenance would otherwise read as "ok" — a false claim that a
 * target was hit when none was ever computed. Silence is preferred to
 * that false confidence.
 */
export function availabilityVerdict(input: VerdictInput): Verdict {
  const { offeredMins, currentCtl, loadPerHour, historyDays, effectiveTarget } =
    input;
  if (historyDays < MIN_HISTORY_DAYS) return { kind: "silent" };
  if (currentCtl == null || loadPerHour == null || loadPerHour <= 0) {
    return { kind: "silent" };
  }
  if (!effectiveTarget || effectiveTarget <= 0) return { kind: "silent" };

  const offeredHrs = offeredMins / 60;
  const maintenanceHrs = (currentCtl * 7) / loadPerHour;
  const targetHrs = effectiveTarget / loadPerHour;

  if (offeredHrs < maintenanceHrs) {
    return {
      kind: "losing",
      maintenanceHrs,
      projectedCtl: projectCtl(currentCtl, offeredHrs * loadPerHour),
    };
  }
  if (offeredHrs < targetHrs) return { kind: "holding", targetHrs };
  return { kind: "ok" };
}

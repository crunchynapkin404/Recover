/**
 * Real "This Week" ring targets (v0.10 Honest Load) — pure functions.
 * The rings compare the week's actual volume/load against a target that
 * actually exists: the open week plan (volume), the active block's
 * target load, or a trailing 28-day average. No target → null → the ring
 * is hidden, never a hardcoded fraction.
 */

import { dedupeActivities } from "./training-load";

export const FALLBACK_WINDOW_DAYS = 28;
/** Trailing-average fallback needs activities on at least this many distinct days. */
export const MIN_FALLBACK_ACTIVITY_DAYS = 6;

/**
 * Planned volume (seconds) of the open week, or null when nothing is planned.
 *
 * Reads `workouts[]`, the shape a DaySlot has carried since the availability
 * redesign — a day can hold two sessions. The old single-`workout` signature
 * still type-checked against nothing (this function has no callers yet), so
 * had it ever been wired up it would have summed zero and returned null,
 * silently hiding the ring rather than failing.
 */
export function plannedWeekVolumeS(
  days: Array<{ workouts: Array<{ durationMins: number }> }>
): number | null {
  const mins = days.reduce(
    (s, d) => s + d.workouts.reduce((t, w) => t + w.durationMins, 0),
    0
  );
  return mins > 0 ? mins * 60 : null;
}

export interface TrailingActivity {
  /** Needed to collapse the same ride synced from two providers. */
  provider: string;
  startDate: Date;
  durationS: number | null;
  /** Engine-resolved load (activityLoad), not raw provider load. */
  loadValue: number | null;
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Trailing 28-day weekly averages as ring fallbacks. Sparse history (fewer
 * than MIN_FALLBACK_ACTIVITY_DAYS distinct activity days in the window)
 * yields nulls — an average of two rides is not a weekly target.
 */
export function trailingWeeklyAverages(
  activities: TrailingActivity[],
  today: Date
): { volumeS: number | null; load: number | null } {
  const floor = new Date(today);
  floor.setDate(floor.getDate() - FALLBACK_WINDOW_DAYS);
  // The same ride reaches us once per connected provider (activities is
  // unique on (provider, external_id), so duplication across providers is by
  // design). Summing raw doubles an athlete's volume — and this function
  // grades their level.
  const window = dedupeActivities(
    activities
      .filter((a) => a.startDate >= floor && a.startDate <= today)
      .map((a) => ({
        provider: a.provider,
        startDate: a.startDate,
        durationS: a.durationS,
        load: a.loadValue,
        avgHr: null,
        avgPower: null,
      }))
  ).map((a) => ({
    startDate: a.startDate,
    durationS: a.durationS,
    loadValue: a.load,
  }));
  const days = new Set(window.map((a) => localYmd(a.startDate)));
  if (days.size < MIN_FALLBACK_ACTIVITY_DAYS) {
    return { volumeS: null, load: null };
  }
  const weeks = FALLBACK_WINDOW_DAYS / 7;
  const totalVolume = window.reduce((s, a) => s + (a.durationS ?? 0), 0);
  const totalLoad = window.reduce((s, a) => s + (a.loadValue ?? 0), 0);
  return {
    volumeS: totalVolume > 0 ? Math.round(totalVolume / weeks) : null,
    load: totalLoad > 0 ? Math.round(totalLoad / weeks) : null,
  };
}

/** Actual ÷ target as a 0–1 ring fraction (capped), or null without a target. */
export function ringFraction(
  actual: number,
  target: number | null
): number | null {
  if (target == null || target <= 0) return null;
  return Math.min(actual / target, 1);
}

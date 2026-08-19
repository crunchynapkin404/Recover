// src/lib/race/taper.ts — pure taper math. No db, no I/O (Principle 1).
import { withPurpose, type PlannedWorkout } from "@/lib/training-plan";

export interface RaceContext {
  date: string; // YYYY-MM-DD
  priority: "A" | "B" | "C";
  raceType: string;
  name: string;
}

/**
 * Taper window length by race distance class, in days out from race day.
 *
 * **Evidence:** `docs/specs/2026-08-19-taper-evidence.md`. These windows were
 * decided as a design choice in v0.14 and carried Confidence: Low until
 * 2026-08-19, when they were checked against the taper literature for the
 * first time. All three land inside what the evidence supports:
 *
 * - Ferreira et al. 2023 (PLOS One), a systematic review and meta-analysis of
 *   14 studies in **endurance athletes**, finds 8-14 days produces the largest
 *   effect and that improvements remain significant at 15-21 days. Tapers of
 *   **22 days or more show diminished effects**.
 * - Bosquet et al. 2007, the mixed-sport taper meta-analysis (27 of 182
 *   studies), puts the optimum at 2 weeks.
 *
 * So SHORT (10) and MID (14) sit in the largest-effect band, and LONG (21) is
 * the **ceiling of the supported range, not a value beyond it** — one day more
 * would cross into the range where the endurance review measures the benefit
 * falling away. Confidence: Medium. It is a coaching-consensus window that the
 * evidence permits, not a figure derived from it.
 *
 * Note what the same review did NOT find: any significant difference by event
 * distance — middle-distance, long-distance and ultra were pooled. Our mapping
 * of longer races to longer tapers is therefore a convention the evidence
 * tolerates rather than one it requires. Do not describe it to the athlete as
 * distance-derived.
 */
export const TAPER_WINDOW_LONG = 21; // marathon / full ironman
export const TAPER_WINDOW_MID = 14; // half / 70.3 / fondo / century
export const TAPER_WINDOW_SHORT = 10; // short course

/**
 * Weekly load as a fraction of the athlete's current actual load.
 *
 * **Evidence:** `docs/specs/2026-08-19-taper-evidence.md`. Both meta-analyses
 * agree the effective reduction in training VOLUME is **41-60%**, and that
 * this is the one figure with a band around it.
 *
 * Read as reductions, this ladder is 20% / 35% / 55%:
 *
 * - Race week's 0.45 — a **55% reduction** — is inside the band.
 * - Over a 2-week window (MID, the largest-effect duration) the two applied
 *   weeks are 35% and 55%, mean 45% — inside the band.
 * - Week−2's 0.80 is a gentler entry that only applies inside the 3-week LONG
 *   window. It is below the band **on its own**, which is the shape both
 *   papers ask for rather than a miss: Bosquet specifies an *exponential
 *   fast-decay* taper, not a step to the target. The ratios here accelerate
 *   (0.81 then 0.69), which is that shape.
 *
 * Confidence: Medium — the endpoint and the 2-week mean are evidenced; the
 * exact rung spacing is still a design choice.
 */
export const TAPER_FRACTION_RACE_WEEK = 0.45;
export const TAPER_FRACTION_WEEK_1 = 0.65;
export const TAPER_FRACTION_WEEK_2 = 0.8;

/**
 * Longest session allowed the day before a race (the "opener"). Source: the
 * v0.14 design doc ("the day before is forced rest or a ≤ 30 min opener").
 * No taper study measures the day-before session in isolation, so this stays
 * a coaching convention. Confidence: Low — unchanged by the 2026-08-19
 * evidence pass, and deliberately so: finding sources for its neighbours is
 * not a source for this.
 */
export const OPENER_MAX_MINS = 30;

export function taperWindowDays(raceType: string): number {
  const rt = raceType.toLowerCase();
  if (rt.includes("70.3") || rt.includes("half")) return TAPER_WINDOW_MID;
  if (rt.includes("marathon") || rt.includes("ironman"))
    return TAPER_WINDOW_LONG;
  if (rt.includes("fondo") || rt.includes("century")) return TAPER_WINDOW_MID;
  return TAPER_WINDOW_SHORT;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round(
    (new Date(toYmd + "T00:00:00").getTime() -
      new Date(fromYmd + "T00:00:00").getTime()) /
      86_400_000
  );
}

/**
 * Which taper fraction applies to the week starting `weekStart`, or null
 * when the week is outside the race's taper window (no reshaping).
 */
export function taperFractionForWeek(
  weekStart: string,
  race: RaceContext
): number | null {
  const d = daysBetween(weekStart, race.date);
  if (d < 0) return null;
  const window = taperWindowDays(race.raceType);
  if (d <= 6) return TAPER_FRACTION_RACE_WEEK;
  if (d <= 13 && window >= TAPER_WINDOW_MID) return TAPER_FRACTION_WEEK_1;
  if (d <= 20 && window >= TAPER_WINDOW_LONG) return TAPER_FRACTION_WEEK_2;
  return null;
}

/**
 * Race-week sessions: volume is gone, intensity touches stay. One short
 * easy session 3 days out, race openers 2 days out, nothing the day
 * before (rest), race day handled by the caller as a race slot.
 *
 * **"Volume is gone, intensity touches stay" is exactly what the evidence
 * prescribes**, and this comment stated it as a principle for two years
 * before anyone connected it to a paper. Both meta-analyses find that
 * maintaining training INTENSITY through the taper is what preserves the
 * gain, and that cutting it is ineffective; the Z3 openers below are that
 * intensity. See `docs/specs/2026-08-19-taper-evidence.md`.
 *
 * **Where we knowingly diverge:** the same review finds training FREQUENCY
 * should also be maintained, and this function does not maintain it — it
 * returns at most two sessions, so an athlete who normally trains five or six
 * days is down to two plus the race. That divergence is deliberate and
 * bounded: it applies to race week ONLY (weeks −1 and −2 scale
 * `targetLoadTotal` and leave the session count alone), and no study in either
 * meta-analysis measured a protocol in which the final day is a maximal race.
 * The race is the frequency the evidence is asking for. Recorded here rather
 * than resolved, because resolving it would mean claiming something about
 * race-week structure that neither paper supports.
 */
export function raceWeekWorkouts(
  sport: string,
  raceDayIdx: number
): PlannedWorkout[] {
  const workouts: PlannedWorkout[] = [];
  if (raceDayIdx >= 3) {
    workouts.push(
      withPurpose({
        day: raceDayIdx - 3,
        sport,
        type: "Endurance",
        durationMins: 30,
        intensity: "Z1-Z2",
        description: "Short easy session — race week, stay loose",
      })
    );
  }
  if (raceDayIdx >= 2) {
    workouts.push(
      withPurpose({
        day: raceDayIdx - 2,
        sport,
        type: "Tempo",
        durationMins: 20,
        intensity: "Z3",
        description: "Race openers: 3×90s at race effort, full recovery",
      })
    );
  }
  return workouts;
}

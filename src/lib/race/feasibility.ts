/**
 * Can this athlete finish this event?
 *
 * The question anyone entering a hard event actually has, and the one nothing
 * in the app answers today.
 *
 * Two gaps, but NOT equal footing. Volume drives the verdict across the full
 * four-rung scale, including "not_realistic" — that ladder rests on the ramp
 * guard the engine already enforces (RAMP_CLAMP_PCT), a real physiological
 * limit on how fast weekly hours can grow.
 *
 * The longest ride is different. Eleven hours a week ridden as five
 * two-hour sessions does not ready anyone for a seven-hour mountain stage,
 * so a longest-ride shortfall matters — but LONGEST_RIDE_FRACTION is
 * contested evidence, not a physiological limit: gran fondo coaching calls
 * the long ride the single biggest predictor of finishing (70-80% of event
 * distance), while CTS says there is nothing magical about it and 3-hour
 * rides can prepare you for a century. A rule that disputed does not get to
 * tell an athlete their event is impossible on its own. It can only soften
 * an already-computed volume verdict by one step, floored at "tight" — it
 * can never be the sole reason a verdict reaches "not_realistic".
 *
 * Weeks-to-close follows from the ramp guard the engine already enforces
 * (RAMP_CLAMP_PCT, +/-20% week over week):
 *
 *   weeksNeeded = ceil( ln(required / current) / ln(1 + RAMP_CLAMP_PCT) )
 *
 * This INFORMS and never blocks. It does not refuse to build a plan or
 * prevent entering an event — an athlete is entitled to attempt something
 * ambitious having been told plainly what it asks.
 *
 * Pure — no I/O, no clock.
 */
import { RAMP_CLAMP_PCT } from "@/lib/week-plan/types";
import { Figure } from "@/lib/uncertainty";
import type { EventDemandResult } from "@/lib/race/demand";

export type Verdict = "ready" | "on_track" | "tight" | "not_realistic";

export const FEASIBILITY_CONSTANTS = {
  /**
   * Longest training session needed, as a share of the hardest event day.
   *
   * Named for a ride because the evidence behind it IS cycling evidence: gran
   * fondo coaching calls the long ride the biggest predictor of finishing
   * (70-80% of event distance), CTS disputes it. v0.46 applies the same
   * fraction to running and triathlon because no better number was found —
   * NOT because it was validated there. Recorded as UNVALIDATED OUTSIDE
   * CYCLING in docs/specs/2026-08-07-race-demand-evidence.md. This is why the
   * rule can only ever soften a verdict by one step and can never, by itself,
   * reach "not_realistic". Confidence: Low, unvalidated outside cycling —
   * the exact rating that evidence doc's own summary table gives this value.
   */
  LONGEST_RIDE_FRACTION: 0.8,
  /**
   * Spare weeks below which "on track" becomes "tight". No evidence doc pins
   * this exact buffer; it is an engineering judgement call with no cited
   * source. Confidence: Low.
   */
  TIGHT_MARGIN_WEEKS: 2,
} as const;

export interface FeasibilityInput {
  requiredWeeklyHours: number;
  /** The athlete's rolling peak weekly hours. */
  currentWeeklyHours: number | null;
  queenStageHours: number;
  queenStageKnown: boolean;
  /** Longest single session in the recent window, in hours. */
  longestSessionHours: number | null;
  weeksUntilEvent: number;
}

export interface Feasibility {
  verdict: Verdict;
  volumeWeeksNeeded: number;
  longestSessionWeeksNeeded: number;
  weeksUntilEvent: number;
  requiredLongestSessionHours: number;
  /** True when queenStageHours is an average, not a known hardest day. */
  fromAverageDay: boolean;
}

/** Worst to best is irrelevant here; this is best-to-worst, index order matters. */
const RUNGS: Verdict[] = ["ready", "on_track", "tight", "not_realistic"];

/** Weeks of compounding ramp-guard growth to get from `current` to `required`. */
function weeksToGrow(current: number, required: number): number {
  if (current >= required) return 0;
  if (current <= 0) return Infinity;
  return Math.ceil(Math.log(required / current) / Math.log(1 + RAMP_CLAMP_PCT));
}

/** The full four-rung ladder, driven by volume weeks-needed vs. weeks free. */
function volumeOnlyVerdict(
  volumeWeeksNeeded: number,
  weeksUntilEvent: number
): Verdict {
  if (volumeWeeksNeeded === 0) return "ready";
  if (volumeWeeksNeeded > weeksUntilEvent) return "not_realistic";
  if (
    weeksUntilEvent - volumeWeeksNeeded <
    FEASIBILITY_CONSTANTS.TIGHT_MARGIN_WEEKS
  ) {
    return "tight";
  }
  return "on_track";
}

export function assessFeasibility(input: FeasibilityInput): Feasibility | null {
  // No measured history means no honest verdict. Same rule as the ceiling:
  // absent evidence, say nothing rather than guess.
  if (input.currentWeeklyHours == null || input.longestSessionHours == null) {
    return null;
  }

  const requiredLongestSessionHours =
    input.queenStageHours * FEASIBILITY_CONSTANTS.LONGEST_RIDE_FRACTION;

  const volumeWeeksNeeded = weeksToGrow(
    input.currentWeeklyHours,
    input.requiredWeeklyHours
  );
  const longestSessionWeeksNeeded = weeksToGrow(
    input.longestSessionHours,
    requiredLongestSessionHours
  );
  const weeksUntilEvent = Math.max(0, input.weeksUntilEvent);

  // Volume alone can reach any rung, including the worst.
  const volumeVerdict = volumeOnlyVerdict(volumeWeeksNeeded, weeksUntilEvent);

  // A longest-session shortfall softens by ONE step and can never, by itself,
  // reach "not_realistic" -- see the file header on why that rule is
  // deliberately weaker than the volume ladder.
  const sessionGap = longestSessionWeeksNeeded > weeksUntilEvent;
  const volumeIndex = RUNGS.indexOf(volumeVerdict);
  const softenedIndex = Math.min(volumeIndex + 1, RUNGS.indexOf("tight"));
  // Math.max against the volume index means a session gap can only ever make
  // the verdict worse (or leave it unchanged), never better.
  const verdict = sessionGap
    ? RUNGS[Math.max(volumeIndex, softenedIndex)]
    : volumeVerdict;

  return {
    verdict,
    volumeWeeksNeeded,
    longestSessionWeeksNeeded,
    weeksUntilEvent,
    requiredLongestSessionHours,
    fromAverageDay: !input.queenStageKnown,
  };
}

/**
 * The one way a surface asks "is this event feasible".
 *
 * Before v0.87 three call sites wrote the same guard inline and collapsed
 * every failure to `null`, so no surface could tell "no tracked race" from
 * "no measured history". Each guard now states its own reason.
 *
 * Confidence is Low for every verdict: FEASIBILITY_CONSTANTS' longest-session
 * fraction is Low and unvalidated outside cycling, and the verdict is only as
 * good as the demand figure feeding it.
 */
export function feasibilityFor(input: {
  demand: EventDemandResult | null;
  currentWeeklyHours: number | null;
  longestSessionHours: number | null;
  weeksUntilEvent: number | null;
}): Figure<Feasibility> {
  if (input.demand == null || !input.demand.available) {
    return Figure.missingInput("a tracked race with computable demand");
  }
  if (input.weeksUntilEvent == null) {
    return Figure.missingInput("a race date to count back from");
  }
  const verdict = assessFeasibility({
    requiredWeeklyHours: input.demand.weeklyHours,
    currentWeeklyHours: input.currentWeeklyHours,
    queenStageHours: input.demand.queenStageHours,
    queenStageKnown: input.demand.queenStageKnown,
    longestSessionHours: input.longestSessionHours,
    weeksUntilEvent: input.weeksUntilEvent,
  });
  if (verdict == null) {
    return Figure.missingInput("measured training history");
  }
  return Figure.available(verdict, "low");
}

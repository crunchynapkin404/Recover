/**
 * What the athlete actually held, against what the model said to hold.
 *
 * `races.resultActivityId` has been stored, exposed over MCP and round-tripped
 * on import since v0.14, and until now nothing read it. This module reads it —
 * the first half of ROADMAP Phase 7 ("Learn from results").
 *
 * A separate module from pacing.ts for the same reason pacing.ts is separate
 * from outlook.ts (that spec's D1): "how hard should I go" and "how hard did I
 * go" are different questions off different inputs, and folding them together
 * makes one file do two jobs.
 *
 * THE TARGET WAS NEVER RECORDED BEFORE THE START. Nothing writes a prediction
 * down at race time, so the target here is recomputed. That is stated in the
 * figure's `why` rather than glossed, and the read path
 * (`racePacingResult` in service.ts) feeds it anchors as they stood on race
 * day so a synced FTP the race itself raised cannot inflate the target the
 * race is then scored against.
 *
 * Pure — no I/O, no clock.
 */
import { Figure } from "@/lib/uncertainty";
import type { PacingTarget } from "./pacing";

/**
 * How far the recorded result may differ from the race's own distance before
 * the comparison refuses.
 *
 * UNCITED ENGINEERING BOUND — Confidence: Low. It models nothing, and it is
 * not derived from anything. It exists to catch the two ways this comparison
 * goes wrong in practice — a DNF, and an activity linked to the wrong race —
 * where "you held 8% under target" would read as a verdict on the athlete's
 * pacing rather than on a race they did not finish. GPS drift on a correctly
 * matched result is ~1-2%, several times narrower, so a real result is never
 * refused by it.
 *
 * Same voice as pacing.ts's PACING_BAND_FRACTION and forecast.ts's
 * ADHERENCE_CEIL. If it is ever measured, this comment is what should be
 * deleted.
 */
export const RESULT_DISTANCE_TOLERANCE = 0.1;

/**
 * The verdict is always in terms of EFFORT, never of the underlying number.
 * For a run this matters: a lower seconds-per-km is a harder effort, so
 * `harder` is the FAST end. It is the one field whose meaning is identical
 * across the two sports, which is why it exists at all.
 */
export type PacingVerdict = "easier" | "inside" | "harder";

/** The result activity, reduced to what a comparison can use. */
export interface ActualEffort {
  /** Provenance. A Strava result is refused — see STRAVA_WHY. */
  provider: "intervals_icu" | "strava" | "manual";
  avgPower: number | null;
  durationS: number | null;
  distanceM: number | null;
}

export type PacingComparison =
  | {
      sport: "Bike";
      targetWatts: number;
      lowWatts: number;
      highWatts: number;
      /** Whole watts — power meters do not show tenths. */
      actualWatts: number;
      /** actual − target. Positive is HARDER, in both sign and meaning. */
      deltaWatts: number;
      /** `deltaWatts` as a percentage of the target, one decimal, same sign. */
      deltaPct: number;
      verdict: PacingVerdict;
      raceDistanceKm: number | null;
      actualDistanceKm: number | null;
    }
  | {
      sport: "Run";
      targetSecPerKm: number;
      /** The FAST end of the band. Lower seconds-per-km is faster. */
      lowSecPerKm: number;
      highSecPerKm: number;
      actualSecPerKm: number;
      /**
       * actual − target seconds per km. POSITIVE IS SLOWER, and therefore
       * EASIER — the one field here whose sign runs opposite to effort. Read
       * `verdict` for effort; this keeps the units it is measured in, because
       * a "delta" that silently flipped its own sign would be worse.
       */
      deltaSecPerKm: number;
      /** `deltaSecPerKm` as a percentage of the target, one decimal, same sign. */
      deltaPct: number;
      verdict: PacingVerdict;
      raceDistanceKm: number | null;
      actualDistanceKm: number | null;
    };

export interface PacingResultInput {
  /**
   * The target, as `racePacing` produces it. Passed as the whole `Figure` and
   * not just its value on purpose: when there is no target, the honest thing
   * to tell the athlete is the reason the target is missing, and that reason
   * is already inside this object with its own fix link.
   */
  predicted: Figure<PacingTarget>;
  /** The race's own recorded distance — what the target was computed for. */
  raceDistanceKm: number | null;
  /** The linked result, or null when none is on file yet. */
  actual: ActualEffort | null;
}

const NO_RESULT_NEEDS = "this race's result activity";

const STRAVA_WHY =
  "The result for this race is a Strava activity, and its numbers are " +
  "excluded from AI analysis under Strava's API agreement — so it can be " +
  "linked to the race, but not scored against the pacing target.";

const RECOMPUTED_WHY =
  "The target was not recorded before the start — it is what the model " +
  "predicts for this race from the anchors that were on file on race day.";

function mismatchWhy(raceKm: number, actualKm: number): string {
  return (
    `The result on file covers ${fmtKm(actualKm)} km and this race is ` +
    `${fmtKm(raceKm)} km. That is too far apart to compare a steady-effort ` +
    `target against — either the race was not finished, or the wrong ` +
    `activity is linked to it.`
  );
}

/** One decimal, but no trailing ".0" on a whole number. */
function fmtKm(km: number): string {
  return String(Math.round(km * 10) / 10);
}

function pct(delta: number, target: number): number {
  return Math.round((delta / target) * 1000) / 10;
}

export function comparePacing(
  input: PacingResultInput
): Figure<PacingComparison> {
  const { predicted, actual, raceDistanceKm } = input;

  // The prediction's own refusal, passed straight through rather than
  // replaced by a second, vaguer one. There is no target to compare against,
  // and "your FTP is not set" is both truer and more actionable than "no
  // comparison available".
  if (!predicted.available) return predicted;

  if (actual == null) return Figure.missingInput(NO_RESULT_NEEDS);
  if (actual.provider === "strava") return Figure.notApplicable(STRAVA_WHY);

  const actualDistanceKm =
    actual.distanceM != null && actual.distanceM > 0
      ? actual.distanceM / 1000
      : null;

  // Above the sport branches: a DNF or a mis-linked activity invalidates
  // either sport's comparison for the same reason.
  if (
    raceDistanceKm != null &&
    raceDistanceKm > 0 &&
    actualDistanceKm != null &&
    Math.abs(actualDistanceKm - raceDistanceKm) / raceDistanceKm >
      RESULT_DISTANCE_TOLERANCE
  ) {
    return Figure.notApplicable(mismatchWhy(raceDistanceKm, actualDistanceKm));
  }

  const why = [predicted.why, RECOMPUTED_WHY].filter(Boolean).join(" ");
  const target = predicted.value;

  if (target.sport === "Bike") {
    if (actual.avgPower == null || !(actual.avgPower > 0)) {
      return Figure.missingInput("average power for the race");
    }
    const actualWatts = Math.round(actual.avgPower);
    return Figure.available(
      {
        sport: "Bike",
        targetWatts: target.targetWatts,
        lowWatts: target.lowWatts,
        highWatts: target.highWatts,
        actualWatts,
        deltaWatts: actualWatts - target.targetWatts,
        deltaPct: pct(actualWatts - target.targetWatts, target.targetWatts),
        // Both edges are inside: an athlete who held exactly the bottom of
        // the band did what was asked.
        verdict:
          actualWatts > target.highWatts
            ? "harder"
            : actualWatts < target.lowWatts
              ? "easier"
              : "inside",
        raceDistanceKm,
        actualDistanceKm,
      },
      // Never more than the prediction claims. A measurement of what the
      // athlete held is certain; what it MEANS is only as good as the target
      // it is held against, and that is the figure being reported here.
      predicted.confidence,
      why
    );
  }

  if (actualDistanceKm == null || actual.durationS == null) {
    return Figure.missingInput("the result's distance and time");
  }
  // The pace the athlete actually ran, over the distance they actually
  // covered — not over the race's recorded distance, which is what the
  // target was computed for but not what was run.
  const actualSecPerKm = Math.round(actual.durationS / actualDistanceKm);
  const delta = actualSecPerKm - target.targetSecPerKm;
  return Figure.available(
    {
      sport: "Run",
      targetSecPerKm: target.targetSecPerKm,
      lowSecPerKm: target.lowSecPerKm,
      highSecPerKm: target.highSecPerKm,
      actualSecPerKm,
      deltaSecPerKm: delta,
      deltaPct: pct(delta, target.targetSecPerKm),
      // INVERTED against the bike branch, deliberately. Fewer seconds per km
      // is a faster pace and a HARDER effort; copying the bike comparison
      // here would report every fast run as easy.
      verdict:
        actualSecPerKm < target.lowSecPerKm
          ? "harder"
          : actualSecPerKm > target.highSecPerKm
            ? "easier"
            : "inside",
      raceDistanceKm,
      actualDistanceKm,
    },
    predicted.confidence,
    why
  );
}

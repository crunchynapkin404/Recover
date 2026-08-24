/**
 * How hard to go in this race — a target, a band around it, and the
 * assumption behind both.
 *
 * NOT A NEW MODEL. riding-time.ts already resolves a sustainable FTP fraction
 * by fixed-point iteration and returns only the hours; running-time.ts already
 * runs Riegel, which predicts race pace by construction. This module derives
 * what those already compute and wraps it in the uncertainty vocabulary.
 *
 * A band here is an INTENSITY RANGE, never positional. `races` stores total
 * distance and total elevation with no course profile, so "hold 210-225 W" is
 * supportable and "ease off on the climb at 40 km" would be invented.
 *
 * Pure — no I/O, no clock.
 */
import { Figure } from "@/lib/uncertainty";
import { DEMAND_CONSTANTS as C } from "./demand-constants";
import { estimateRidingHours, ftpFractionFor } from "./riding-time";
import { estimateRunningHours } from "./running-time";
import type { FtpSource } from "./service";

/**
 * Half-width of the pacing band, as a fraction of the target.
 *
 * UNCITED, SYMMETRIC ENGINEERING BOUND — Confidence: Low. There is no
 * published figure for how wide a pacing tolerance should be, and this is not
 * derived from anything. It is wide enough to hold on real terrain without a
 * power meter twitching the athlete around, and narrow enough that the top of
 * the band is not a different workout from the bottom. ±5% of 250 W is
 * 237-263 W; of 5:00/km, 4:45-5:15.
 *
 * Same voice, and the same honesty, as forecast.ts's ADHERENCE_CEIL. It does
 * NOT widen with lower confidence — confidence is reported separately, in
 * words, because encoding it as a wider band would look derived, and would
 * quietly make a low-confidence figure harder to be wrong about rather than
 * more useful.
 *
 * If it is ever measured, this comment is what should be deleted.
 */
export const PACING_BAND_FRACTION = 0.05;

export interface PacingInput {
  sport: "Bike" | "Run" | "Triathlon";
  distanceKm: number | null;
  elevationM: number | null;
  eventDays: number;
  ftpWatts: number | null;
  massKg: number | null;
  thresholdPaceSecPerKm: number | null;
  /**
   * Which FTP this anchor is. Omitted defaults to the same "treat as best
   * case" behavior `ftpAthleteSet`'s absence used to have — an omitted flag
   * must never silently downgrade an existing caller.
   */
  ftpSource?: FtpSource;
  runPaceAthleteSet?: boolean;
}

export type PacingTarget =
  | {
      sport: "Bike";
      /** Whole watts — power meters do not show tenths. */
      targetWatts: number;
      lowWatts: number;
      highWatts: number;
      /** The resolved share of FTP this target represents. */
      ftpFraction: number;
      hours: number;
    }
  | {
      sport: "Run";
      /** Whole seconds per km. LOWER is faster, so lowSecPerKm is the FAST end. */
      targetSecPerKm: number;
      lowSecPerKm: number;
      highSecPerKm: number;
      hours: number;
    };

/** The 8h anchor's own words, repeated to the athlete rather than paraphrased. */
/**
 * Deliberately terse. The feasibility card directly above this on Train
 * already says "estimated from your recent runs — set a threshold pace in
 * Settings for a sharper figure", and repeating that in full put six lines of
 * grey text under the race chip on a phone. Say the part this figure adds —
 * that it is estimated — and let the card above carry the instruction.
 */
const DERIVED_ANCHOR_WHY = "Estimated from recent sessions, not measured.";

const INDOOR_ANCHOR_WHY = "Uses your indoor FTP — outdoor effort may differ.";

const LONG_EVENT_WHY =
  "Past 8 h the sustainable-effort figure is a reading of an older band, not a " +
  "published measurement — treat this as a starting point and adjust by feel.";

const TRIATHLON_WHY =
  "Triathlon pacing is not supported yet. How hard you ride determines what " +
  "is left for the run, and that link is not modelled — a bike target worked " +
  "out as if no run followed would be worse than no target at all.";

const MULTI_DAY_WHY =
  "This event runs over more than one day, and the distance recorded is the " +
  "total across all of them — a single sustainable effort for that total " +
  "would not describe any of the days.";

/** Where an athlete sets both anchors: BodyPrefsCard on /settings. */
const ANCHOR_FIX = { label: "Set it", href: "/settings" };

const RUN_WHY =
  "Assumes an even effort at the pace Riegel's endurance model predicts for " +
  "this distance from your threshold pace, with climbing priced as extra flat " +
  "distance.";

const BIKE_WHY =
  "Assumes a steady effort at a share of your FTP that falls as the event gets " +
  "longer, on a course averaged from its total distance and climbing.";

export function racePacing(input: PacingInput): Figure<PacingTarget> {
  const { sport, distanceKm, elevationM, ftpWatts, massKg } = input;

  // Both guards sit above the sport branches: they apply to every sport, and
  // refusing is a first-class result here rather than a gap to paper over.
  if (input.eventDays > 1) return Figure.notApplicable(MULTI_DAY_WHY);
  if (sport === "Triathlon") return Figure.notApplicable(TRIATHLON_WHY);

  if (sport === "Bike") {
    if (distanceKm == null || !(distanceKm > 0)) {
      return Figure.missingInput("this race's distance");
    }
    if (ftpWatts == null || !(ftpWatts > 0)) {
      return Figure.missingInput("your FTP", ANCHOR_FIX);
    }
    const hours = estimateRidingHours({
      distanceKm,
      elevationM: elevationM ?? 0,
      ftpWatts,
      massKg: massKg ?? C.DEFAULT_MASS_KG,
    });
    if (hours == null) return Figure.missingInput("this race's distance");

    const ftpFraction = ftpFractionFor(hours);
    const targetWatts = Math.round(ftpWatts * ftpFraction);
    const half = targetWatts * PACING_BAND_FRACTION;
    const anchors = C.FTP_FRACTION_ANCHORS;
    const long = hours >= anchors[anchors.length - 1].hours;
    const derived = input.ftpSource === "synced";
    const indoorFallback = input.ftpSource === "indoor";
    const why = [
      BIKE_WHY,
      long ? LONG_EVENT_WHY : null,
      indoorFallback ? INDOOR_ANCHOR_WHY : null,
      derived ? DERIVED_ANCHOR_WHY : null,
    ]
      .filter(Boolean)
      .join(" ");

    return Figure.available(
      {
        sport: "Bike",
        targetWatts,
        lowWatts: Math.round(targetWatts - half),
        highWatts: Math.round(targetWatts + half),
        ftpFraction,
        hours,
      },
      long || derived || indoorFallback ? "low" : "medium",
      why
    );
  }

  if (sport === "Run") {
    if (distanceKm == null || !(distanceKm > 0)) {
      return Figure.missingInput("this race's distance");
    }
    const secPerKm = input.thresholdPaceSecPerKm;
    if (secPerKm == null || !(secPerKm > 0)) {
      return Figure.missingInput("your threshold pace", ANCHOR_FIX);
    }
    const hours = estimateRunningHours({
      distanceKm,
      elevationM: elevationM ?? 0,
      thresholdPaceSecPerKm: secPerKm,
    });
    if (hours == null) return Figure.missingInput("this race's distance");

    const targetSecPerKm = Math.round((hours * 3600) / distanceKm);
    const half = targetSecPerKm * PACING_BAND_FRACTION;
    const derived = input.runPaceAthleteSet === false;

    return Figure.available(
      {
        sport: "Run",
        targetSecPerKm,
        // Lower seconds-per-km is FASTER. Named for speed, not magnitude:
        // lowSecPerKm is the fast end of the band.
        lowSecPerKm: Math.round(targetSecPerKm - half),
        highSecPerKm: Math.round(targetSecPerKm + half),
        hours,
      },
      derived ? "low" : "medium",
      derived ? `${RUN_WHY} ${DERIVED_ANCHOR_WHY}` : RUN_WHY
    );
  }

  return Figure.notApplicable("Not supported for this sport yet.");
}

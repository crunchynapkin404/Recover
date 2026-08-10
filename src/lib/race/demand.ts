/**
 * What an event asks of a training week.
 *
 * A one-day race is not a separate case — it is an event with `eventDays = 1`,
 * and the same arithmetic covers a criterium and an eight-day alpine tour:
 *
 *   ratio(days) = EVENT_TO_WEEKLY_1DAY × days ^ MULTI_DAY_EXPONENT
 *   weeklyHours = totalEventHours / ratio(days)
 *
 * One quantity — the event's total load as a multiple of a weekly training
 * load — with the multiple growing as the event lengthens. Both endpoints come
 * from published sources: 0.60 at one day, 2.50 at eight.
 *
 * Nobody trains fifty hours a week for a fifty-hour tour. The rest of a stage
 * event's demand is met by plan SHAPE — back-to-back long rides — because the
 * quality such events test is recovering overnight and riding again.
 *
 * Pure — no I/O, no clock.
 */
import type { PlanSport } from "@/lib/plan-sport";
import { DEMAND_CONSTANTS as C } from "./demand-constants";
import { estimateRidingHours } from "./riding-time";
import { estimateRunningHours } from "./running-time";
import { estimateSwimHours } from "./swim-time";
import { triathlonLegsFor } from "./triathlon-legs";

export interface EventStage {
  dayNumber: number;
  distanceKm: number | null;
  elevationM: number | null;
}

export interface EventDemandInput {
  /** The dispatch key. Stored on every race since v0.42. */
  sport: PlanSport;
  /** Free text or the plan tool's enum; normalised before use. */
  raceType: string;
  eventDays: number;
  /** TOTAL across all days. Ignored when `stages` are supplied. */
  distanceKm: number | null;
  elevationM: number | null;
  stages: EventStage[];
  overrideWeeklyHours: number | null;
  /**
   * The athlete's own figure for how long THE EVENT takes. Wins over every
   * model, needs no anchor, and skips leg pricing entirely.
   */
  expectedFinishHours: number | null;
  ftp: { watts: number; athleteSet: boolean } | null;
  massKg: number | null;
  runPace: { secPerKm: number; athleteSet: boolean } | null;
  swimPace: { secPer100m: number; athleteSet: boolean } | null;
}

export interface EventDemand {
  /** Estimated riding hours for the whole event. */
  totalHours: number;
  /** Average hours per event day. */
  dailyRateHours: number;
  /** The hardest single day; equals dailyRateHours when stages are unknown. */
  queenStageHours: number;
  /** False when queenStageHours is an average rather than a known hardest day. */
  queenStageKnown: boolean;
  weeklyHours: number;
  source: "computed" | "override";
  confidence: DemandConfidence;
  /** One sentence saying where the number came from. Athlete-facing. */
  confidenceReason: string;
}

/**
 * How much to trust the figure. The Domestique pattern: cap the confidence
 * and say so, rather than reporting a derived number flat.
 *
 *   high   — the athlete stated their finish time
 *   medium — modelled from an anchor the athlete set themselves
 *   low    — modelled from a synced or history-derived anchor, or from an
 *            average day rather than known stages
 */
export type DemandConfidence = "high" | "medium" | "low";

/**
 * Why no figure could be produced. A closed union, so a new refusal path
 * cannot be added without deciding what the athlete is told about it.
 */
export type DemandUnavailableReason =
  | "no_cycling_anchor"
  | "no_running_anchor"
  | "no_swim_anchor"
  | "unknown_triathlon_format"
  | "no_distance";

/**
 * One sentence per refusal, each naming the fix.
 *
 * These reach the athlete AND the coach from this one place, so the two
 * surfaces cannot say different things — the discipline assembleWeeklyTarget
 * already enforces for the hours number, applied to its provenance.
 */
export const DEMAND_UNAVAILABLE_COPY: Record<DemandUnavailableReason, string> =
  {
    no_cycling_anchor:
      "No FTP yet — set one in Settings, or add your expected finish time to this race.",
    no_running_anchor:
      "No threshold pace and not enough recent runs to derive one — set a threshold pace in Settings, or add your expected finish time to this race.",
    no_swim_anchor:
      "No recent swims to price the swim leg from — add your expected finish time to this race.",
    unknown_triathlon_format:
      "Unrecognised triathlon format, so the leg distances are unknown — add your expected finish time to this race.",
    no_distance:
      "No distance on this race yet — add one, or add your expected finish time.",
  };

/**
 * Confidence copy when every anchor the duration step used was set by the
 * athlete themselves (an FTP or threshold pace typed into Settings, or a race
 * form) rather than derived from history. Per sport, because "FTP" means
 * nothing to a runner and vice versa.
 *
 * The `Triathlon` entry is currently UNREACHABLE, and is kept rather than
 * deleted because the day it becomes reachable is a known one. A triathlon's
 * `allAnchorsAthleteSet` requires `swimPace.athleteSet`, and there is no
 * athlete-set swim pace anywhere in this codebase: no `body_prefs` column
 * beside `ftpWatts` and `thresholdPaceSecPerKm`, no Settings control, and
 * `volume-inputs.ts` supplies swim pace only from `swimPaceFromHistory()`
 * with `athleteSet: false`. So a triathlon is pinned at "low" however much
 * the athlete configures. An earlier version of this comment claimed a swim
 * pace could be "typed into Settings"; it never could.
 */
const ANCHOR_SET_COPY: Record<PlanSport, string> = {
  Bike: "Modelled from your FTP and the course profile.",
  Run: "Modelled from your threshold pace and the course profile.",
  Triathlon: "Modelled from your own thresholds and the standard distances.",
};

/**
 * Confidence copy when at least one anchor used was derived rather than
 * athlete-set — a synced FTP or a pace inferred from recent history. Same
 * per-sport shape as ANCHOR_SET_COPY, naming the fix.
 *
 * The `Triathlon` line names the swim explicitly because of the pin described
 * above. It previously read "set your thresholds in Settings for a sharper
 * figure", which a triathlete who had already set both their FTP and their
 * threshold pace would read as advice to do something they had done — and
 * which could not have lifted the rating anyway, since the anchor holding it
 * down is the one with no setting to reach. The nudge is kept, because
 * setting an FTP and a threshold pace genuinely does sharpen the bike and run
 * legs; only the false promise about the rating is gone.
 */
const ANCHOR_DERIVED_COPY: Record<PlanSport, string> = {
  Bike: "Estimated from your synced FTP — set one in Settings for a sharper figure.",
  Run: "Estimated from your recent runs — set a threshold pace in Settings for a sharper figure.",
  Triathlon:
    "Estimated partly from your recent sessions. Setting your FTP and threshold pace in Settings sharpens the bike and run legs; the swim is always paced from your recent swims.",
};

/**
 * Confidence copy when the athlete's own stated finish time won outright —
 * the "high" branch, set before the sport dispatch even runs. A single
 * sentence rather than a per-sport record like ANCHOR_SET_COPY: the athlete
 * typed one number, not a sport-specific anchor, so there is nothing to key
 * a record on.
 */
const STATED_FINISH_TIME_COPY = "Your expected finish time.";

/**
 * A discriminated result rather than `EventDemand | null`.
 *
 * The null return is what let F3 hide for four releases: `volume.ts` took its
 * `raceDemandHours == null` branch and reverted the entire race-driven volume
 * feature to `constraints.hoursPerWeek` without a word on any screen. A caller
 * cannot consume this type without handling the unavailable branch, which is
 * the same mechanism v0.39's `Carried<>` and v0.40's `Record<SecurityEvent,
 * true>` witness use: put the guarantee in the compiler, not in a reviewer.
 */
export type EventDemandResult =
  | ({ available: true } & EventDemand)
  | { available: false; reason: DemandUnavailableReason };

/** What the duration step produced, plus the provenance of what it used. */
interface Priced {
  totalHours: number;
  queenStageHours: number | null;
  queenStageKnown: boolean;
  /** False as soon as any anchor used was derived rather than athlete-set. */
  allAnchorsAthleteSet: boolean;
}

/** Prices one distance/elevation pair for one sport, or says why it cannot. */
function priceLeg(
  sport: "Bike" | "Run",
  distanceKm: number,
  elevationM: number,
  input: EventDemandInput
): { hours: number } | { reason: DemandUnavailableReason } {
  if (sport === "Bike") {
    if (input.ftp == null || input.ftp.watts <= 0) {
      return { reason: "no_cycling_anchor" };
    }
    const hours = estimateRidingHours({
      distanceKm,
      elevationM,
      ftpWatts: input.ftp.watts,
      massKg: input.massKg ?? C.DEFAULT_MASS_KG,
    });
    return hours == null ? { reason: "no_distance" } : { hours };
  }
  if (input.runPace == null || input.runPace.secPerKm <= 0) {
    return { reason: "no_running_anchor" };
  }
  const hours = estimateRunningHours({
    distanceKm,
    elevationM,
    thresholdPaceSecPerKm: input.runPace.secPerKm,
  });
  return hours == null ? { reason: "no_distance" } : { hours };
}

export function eventDemand(input: EventDemandInput): EventDemandResult {
  // A zero or negative day count is data corruption, not a rest event.
  const days = Math.max(1, Math.floor(input.eventDays || 1));
  let priced: Priced;
  let confidence: DemandConfidence | null = null;
  let confidenceReason = "";

  // 1. A stated finish time wins outright and needs no anchor. This is what
  //    rescues every refusal below: an unrecognised triathlon format, a
  //    missing swim history and a runner with no threshold pace are all
  //    answered by one number the athlete already knows.
  if (input.expectedFinishHours != null && input.expectedFinishHours > 0) {
    priced = {
      totalHours: input.expectedFinishHours,
      queenStageHours: null,
      queenStageKnown: false,
      allAnchorsAthleteSet: true,
    };
    confidence = "high";
    confidenceReason = STATED_FINISH_TIME_COPY;
  } else if (input.sport === "Triathlon") {
    // 2. Legs come from the format, not from distanceKm — a triathlon's
    //    226 km total does not decompose into 3.8 / 180 / 42.2.
    const legs = triathlonLegsFor(input.raceType);
    if (legs == null) {
      return { available: false, reason: "unknown_triathlon_format" };
    }
    if (input.swimPace == null || input.swimPace.secPer100m <= 0) {
      return { available: false, reason: "no_swim_anchor" };
    }
    const swimHours = estimateSwimHours(legs.swimKm, input.swimPace.secPer100m);
    if (swimHours == null) {
      return { available: false, reason: "no_swim_anchor" };
    }
    // A triathlon's climbing is overwhelmingly on the bike. Documented
    // approximation, not a measurement.
    const bike = priceLeg("Bike", legs.bikeKm, input.elevationM ?? 0, input);
    if ("reason" in bike) return { available: false, reason: bike.reason };
    const run = priceLeg("Run", legs.runKm, 0, input);
    if ("reason" in run) return { available: false, reason: run.reason };

    priced = {
      totalHours: swimHours + bike.hours + run.hours,
      queenStageHours: null,
      queenStageKnown: false,
      allAnchorsAthleteSet:
        input.swimPace.athleteSet &&
        (input.ftp?.athleteSet ?? false) &&
        (input.runPace?.athleteSet ?? false),
    };
  } else {
    // 3. Bike and Run share the stage / average-day structure. This is the
    //    pre-v0.46 body with estimateRidingHours swapped for priceLeg, and
    //    it must stay structurally identical — the Task 4 freeze test is the
    //    proof that it did.
    const sport = input.sport; // narrowed to "Bike" | "Run" by the branch above

    // priceLeg requires distanceKm > 0 and refuses otherwise — an
    // elevation-only stage would silently `continue` past the loop below,
    // shrinking the sum's day-count without shrinking `days` (the ratio
    // divisor), understating demand. Require distance here, at the same
    // boundary, so a stage is either fully usable or fully excluded.
    const usable = input.stages.filter((s) => (s.distanceKm ?? 0) > 0);

    let totalHours: number | null = null;
    let queenStageHours: number | null = null;
    let queenStageKnown = false;

    if (usable.length > 0) {
      let sum = 0;
      let hardest = 0;
      for (const stage of usable) {
        const leg = priceLeg(
          sport,
          stage.distanceKm ?? 0,
          stage.elevationM ?? 0,
          input
        );
        // A MISSING ANCHOR refuses the whole event; only an unusable
        // DISTANCE skips a stage. Collapsing the two would let a runner with
        // no pace anchor fall through to the average-day path and refuse
        // there by luck rather than by design — and a stage race would then
        // report a total built from however many stages happened to price.
        if ("reason" in leg) {
          if (leg.reason !== "no_distance") {
            return { available: false, reason: leg.reason };
          }
          continue;
        }
        sum += leg.hours;
        hardest = Math.max(hardest, leg.hours);
      }
      if (sum > 0) {
        totalHours = sum;
        queenStageHours = hardest;
        // Only claim the hardest day is truly KNOWN when every event day
        // contributed a usable stage — unchanged from pre-v0.46, including
        // the reasoning in the comment there.
        queenStageKnown = usable.length >= days;
      }
    }

    if (totalHours == null) {
      // Without stage data, estimate the AVERAGE DAY and multiply. Pricing
      // the whole event as one continuous effort would charge an 8-day tour
      // the deep-fatigue fraction a rider earns only by riding 42 hours
      // without sleeping.
      const perDay = priceLeg(
        sport,
        (input.distanceKm ?? 0) / days,
        (input.elevationM ?? 0) / days,
        input
      );
      if ("reason" in perDay) {
        return { available: false, reason: perDay.reason };
      }
      totalHours = perDay.hours * days;
    }

    priced = {
      totalHours,
      queenStageHours,
      queenStageKnown,
      allAnchorsAthleteSet:
        sport === "Bike"
          ? (input.ftp?.athleteSet ?? false)
          : (input.runPace?.athleteSet ?? false),
    };
  }

  const dailyRateHours = priced.totalHours / days;
  // Without stage detail the hardest day is unknown; the average is the
  // honest stand-in, and `queenStageKnown` tells consumers not to trust it
  // as a longest-ride target.
  const queen = priced.queenStageKnown
    ? priced.queenStageHours!
    : dailyRateHours;

  if (confidence == null) {
    confidence = priced.allAnchorsAthleteSet ? "medium" : "low";
    confidenceReason = priced.allAnchorsAthleteSet
      ? ANCHOR_SET_COPY[input.sport]
      : ANCHOR_DERIVED_COPY[input.sport];
  }

  // Three individually sound anchors do not compose into a sound triathlon
  // estimate: swim, bike and run interact — the fatigue an athlete carries
  // out of the water changes their bike, and the bike changes the run — in a
  // way a single-sport pace or FTP anchor never has to account for. "medium"
  // only ever means every anchor used was athlete-set, so this only fires
  // there: a stated finish time is already "high" and bypasses this block
  // entirely (the athlete told us the number; leg interaction is baked in),
  // and an already-derived anchor is already "low" with nothing lower to
  // fall to. This lowers a claim, it never raises one.
  //
  // LATENT, deliberately. As ANCHOR_SET_COPY explains, a triathlon cannot
  // currently reach "medium" at all — there is no athlete-set swim pace in
  // this codebase, so `allAnchorsAthleteSet` is structurally false for the
  // sport and this block never executes in production. It is kept as a
  // pre-placed guard rather than deleted: the moment a swim anchor is added,
  // triathlon would jump from "low" straight to "medium" as a side effect of
  // an unrelated feature, and this is what stops that silent promotion. Its
  // tests exercise `eventDemand()` directly, which is honest for a rule on a
  // pure function — but nothing at any surface guards it, and nothing can
  // until the pin is gone.
  if (input.sport === "Triathlon" && confidence === "medium") {
    confidence = "low";
    confidenceReason = `${confidenceReason} Multi-sport estimates are downgraded because swim, bike, and run anchors interact.`;
  }

  // The event's total load as a multiple of a weekly training load, with the
  // multiple growing as the event lengthens. An earlier draft averaged over
  // days and trained at a fixed share of that daily rate — which discarded
  // total event load entirely, so a 42h 8-day tour asked for LESS weekly
  // training than a 6.8h one-day fondo. Eight consecutive days are cumulative.
  const ratio = C.EVENT_TO_WEEKLY_1DAY * Math.pow(days, C.MULTI_DAY_EXPONENT);
  const computedWeekly = priced.totalHours / ratio;
  const override = input.overrideWeeklyHours;
  const useOverride = override != null && override > 0;

  return {
    available: true,
    totalHours: priced.totalHours,
    dailyRateHours,
    queenStageHours: queen,
    queenStageKnown: priced.queenStageKnown,
    weeklyHours: useOverride ? override : computedWeekly,
    source: useOverride ? "override" : "computed",
    confidence,
    confidenceReason,
  };
}

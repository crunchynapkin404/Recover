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
import { DEMAND_CONSTANTS as C } from "./demand-constants";
import { estimateRidingHours } from "./riding-time";

export interface EventStage {
  dayNumber: number;
  distanceKm: number | null;
  elevationM: number | null;
}

export interface EventDemandInput {
  eventDays: number;
  /** TOTAL across all days. Ignored when `stages` are supplied. */
  distanceKm: number | null;
  elevationM: number | null;
  stages: EventStage[];
  overrideWeeklyHours: number | null;
  ftpWatts: number | null;
  massKg: number | null;
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

export function eventDemand(input: EventDemandInput): EventDemandResult {
  const ftpWatts = input.ftpWatts;
  if (ftpWatts == null || ftpWatts <= 0) {
    return { available: false, reason: "no_cycling_anchor" };
  }
  const massKg = input.massKg ?? C.DEFAULT_MASS_KG;

  // A zero or negative day count is data corruption, not a rest event.
  const days = Math.max(1, Math.floor(input.eventDays || 1));

  // estimateRidingHours requires distanceKm > 0 and returns null otherwise —
  // an elevation-only stage would silently `continue` past the loop below,
  // shrinking the sum's day-count without shrinking `days` (the ratio()
  // divisor), understating demand. Require distance here, at the same
  // boundary, so a stage is either fully usable or fully excluded — never
  // admitted here and dropped two lines later.
  const usable = input.stages.filter((s) => (s.distanceKm ?? 0) > 0);

  let totalHours: number | null = null;
  let queenStageHours: number | null = null;
  let queenStageKnown = false;

  if (usable.length > 0) {
    let sum = 0;
    let hardest = 0;
    for (const stage of usable) {
      const h = estimateRidingHours({
        distanceKm: stage.distanceKm ?? 0,
        elevationM: stage.elevationM ?? 0,
        ftpWatts,
        massKg,
      });
      if (h == null) continue;
      sum += h;
      hardest = Math.max(hardest, h);
    }
    if (sum > 0) {
      totalHours = sum;
      queenStageHours = hardest;
      // Only claim the hardest day is truly KNOWN — and let EventReadiness
      // drop its "reasoning from an average day" caveat — when every event
      // day contributed a usable stage. A race form lets an athlete fill in
      // elevation for all `days` but distance for only some of them
      // (stagesForSubmit emits a row whenever either field is set); with
      // fewer usable stages than event days, the unpriced days are simply
      // missing from `sum`, not zero-cost, so the total still understates
      // demand and the caveat must stay on.
      queenStageKnown = usable.length >= days;
    }
  }

  if (totalHours == null) {
    // Without stage data, estimate the AVERAGE DAY and multiply. Pricing the
    // whole event as one continuous ride would charge an 8-day tour the
    // deep-fatigue fraction a rider earns only by riding 42 hours without
    // sleeping. The FTP ladder models within-ride fatigue; riders sleep
    // between stages.
    //
    // Cumulative fatigue across consecutive days is real and is NOT modelled
    // here — there is no published magnitude for it in the evidence base, and
    // inventing one by mispricing the duration is worse than omitting it.
    const perDay = estimateRidingHours({
      distanceKm: (input.distanceKm ?? 0) / days,
      elevationM: (input.elevationM ?? 0) / days,
      ftpWatts,
      massKg,
    });
    totalHours = perDay == null ? null : perDay * days;
  }
  if (totalHours == null) {
    return { available: false, reason: "no_distance" };
  }

  const dailyRateHours = totalHours / days;
  // Without stage detail the hardest day is unknown; the average is the
  // honest stand-in, and `queenStageKnown` tells consumers not to trust it
  // as a longest-ride target.
  const queen = queenStageKnown ? queenStageHours! : dailyRateHours;

  // The event's total load as a multiple of a weekly training load, with the
  // multiple growing as the event lengthens. An earlier draft averaged over
  // days and trained at a fixed share of that daily rate — which discarded
  // total event load entirely, so a 42h 8-day tour asked for LESS weekly
  // training than a 6.8h one-day fondo. Eight consecutive days are cumulative.
  const ratio = C.EVENT_TO_WEEKLY_1DAY * Math.pow(days, C.MULTI_DAY_EXPONENT);
  const computedWeekly = totalHours / ratio;
  const override = input.overrideWeeklyHours;
  const useOverride = override != null && override > 0;

  return {
    available: true,
    totalHours,
    dailyRateHours,
    queenStageHours: queen,
    queenStageKnown,
    weeklyHours: useOverride ? override : computedWeekly,
    source: useOverride ? "override" : "computed",
    // Task 5 replaces this with real sport-aware provenance. Until then the
    // cycling path reports what it has always been: a modelled figure.
    confidence: "medium",
    confidenceReason: "Modelled from your FTP and the course profile.",
  };
}

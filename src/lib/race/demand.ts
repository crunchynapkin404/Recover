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
}

export function eventDemand(input: EventDemandInput): EventDemand | null {
  const ftpWatts = input.ftpWatts;
  if (ftpWatts == null || ftpWatts <= 0) return null;
  const massKg = input.massKg ?? C.DEFAULT_MASS_KG;

  // A zero or negative day count is data corruption, not a rest event.
  const days = Math.max(1, Math.floor(input.eventDays || 1));

  const usable = input.stages.filter(
    (s) => (s.distanceKm ?? 0) > 0 || (s.elevationM ?? 0) > 0
  );

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
      queenStageKnown = true;
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
  if (totalHours == null) return null;

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
    totalHours,
    dailyRateHours,
    queenStageHours: queen,
    queenStageKnown,
    weeklyHours: useOverride ? override : computedWeekly,
    source: useOverride ? "override" : "computed",
  };
}

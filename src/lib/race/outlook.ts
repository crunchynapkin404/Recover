// src/lib/race/outlook.ts — what the athlete is told about their next race.
// The projection math lives in forecast.ts, the pure ForecastResult →
// RaceOutlook mapping in outlook-figure.ts; this layer owns DB assembly and
// the single decision of what to show, including when there is nothing to
// show.
import { Figure, type Confidence, type Unavailable } from "@/lib/uncertainty";
import type { OpenWeekPlan } from "@/lib/week-plan/service";
import { assembleForecastInputs, nextUpcomingRace } from "./service";
import {
  forecastForm,
  simulatePlanChange,
  type PlanChange,
  type ScenarioEnd,
} from "./forecast";
import {
  raceOutlook,
  CAPPED_WHY,
  FULL_WHY,
  type RaceOutlook,
} from "./outlook-figure";
import { localYmd } from "@/lib/insights/auto-tags";
import { racePacing, type PacingTarget } from "./pacing";
import { pacingAnchors } from "./service";

export type { RaceOutlook };

export interface RaceCard {
  race: {
    name: string;
    date: string;
    priority: string;
    goalNote: string | null;
  } | null;
  daysOut: number | null;
  outlook: RaceOutlook | null;
  /** null only when there is no race at all. */
  pacing: Figure<PacingTarget> | null;
}

/**
 * The one read path for the race card on Today and Train.
 *
 * Both pages built this inline before v0.87 — ~35 character-identical lines
 * each — so a change to one page's honesty silently diverged from the other.
 */
export async function raceCard(
  userId: string,
  now: Date,
  preloadedWeek?: OpenWeekPlan | null
): Promise<RaceCard> {
  const today = localYmd(now);
  const race = await nextUpcomingRace(userId, now);
  if (!race) return { race: null, daysOut: null, outlook: null, pacing: null };

  const assembled = await assembleForecastInputs(
    userId,
    race,
    now,
    preloadedWeek
  );

  const outlook: RaceOutlook = !assembled
    ? Figure.missingInput("an active training plan", {
        label: "Plan it",
        href: "/train?tab=week",
      })
    : raceOutlook(forecastForm(assembled.inputs));

  const anchors = await pacingAnchors(userId);
  const pacing = racePacing({
    sport: race.sport,
    distanceKm: race.distanceKm,
    elevationM: race.elevationM,
    eventDays: race.eventDays ?? 1,
    ftpWatts: anchors.ftpWatts,
    massKg: anchors.massKg,
    thresholdPaceSecPerKm: anchors.thresholdPaceSecPerKm,
    ftpAthleteSet: anchors.ftpAthleteSet,
    runPaceAthleteSet: anchors.runPaceAthleteSet,
  });

  return {
    race: {
      name: race.name,
      date: race.date,
      priority: race.priority,
      goalNote: race.goalNote,
    },
    daysOut: Math.max(
      0,
      Math.round(
        (new Date(race.date + "T00:00:00").getTime() -
          new Date(today + "T00:00:00").getTime()) /
          86_400_000
      )
    ),
    outlook,
    pacing,
  };
}

export type SimulatedRaceForm =
  | {
      available: true;
      value: {
        anchor: { race: string | null; date: string };
        before: ScenarioEnd;
        after: ScenarioEnd;
        deltaTsb: number;
        loadDelta: number;
        capped: boolean;
      };
      confidence: Confidence;
      why?: string;
    }
  | ({ available: false } & Unavailable & {
        /**
         * Independent of CTL/ATL: `simulatePlanChange` computes it from
         * planned loads alone, so it survives even when the projection
         * itself is unavailable for missing training-load history. Absent
         * when there is no plan at all to diff against — nothing planned,
         * nothing to know.
         */
        loadDelta?: number;
      });

/**
 * The one read path for "what would this change do to race-day form".
 *
 * Before v0.87 `plan/actions.ts` and the `simulate_plan_change` tool each ran
 * this chain and encoded the no-projection case their own way — a boolean
 * with nulled fields in one, prose in the other.
 */
export async function simulateRaceForm(
  userId: string,
  change: PlanChange,
  now = new Date()
): Promise<SimulatedRaceForm> {
  const race = await nextUpcomingRace(userId, now);
  const assembled = await assembleForecastInputs(userId, race, now);
  if (!assembled) {
    return Figure.missingInput("an active training plan", {
      label: "Plan it",
      href: "/train?tab=week",
    });
  }
  const r = simulatePlanChange(assembled.inputs, change);
  if (r.deltaTsb == null || r.before.insufficient || r.after.insufficient) {
    // Not built through the Figure.missingInput() factory: its declared
    // return type is the full Figure<never> union, and spreading a union
    // into a fresh object literal defeats excess-property checking on the
    // extra `loadDelta` field. A plain literal here checks directly against
    // SimulatedRaceForm's unavailable arm instead.
    return {
      available: false,
      kind: "missing_input",
      needs: "training-load history",
      loadDelta: r.loadDelta,
    };
  }
  return Figure.available(
    {
      anchor: {
        race: assembled.race?.name ?? null,
        date: assembled.inputs.targetDate,
      },
      before: r.before.full,
      after: r.after.full,
      deltaTsb: r.deltaTsb,
      loadDelta: r.loadDelta,
      capped: r.before.capped,
    },
    "low",
    r.before.capped ? CAPPED_WHY : FULL_WHY
  );
}

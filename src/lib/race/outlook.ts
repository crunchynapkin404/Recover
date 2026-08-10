// src/lib/race/outlook.ts — what the athlete is told about their next race.
// The projection math lives in forecast.ts; this layer owns the single
// decision of what to show, including when there is nothing to show.
import { Figure } from "@/lib/uncertainty";
import type { OpenWeekPlan } from "@/lib/week-plan/service";
import { assembleForecastInputs, nextUpcomingRace } from "./service";
import { forecastForm, type ScenarioEnd } from "./forecast";
import { localYmd } from "@/lib/insights/auto-tags";

export type RaceOutlook = Figure<{
  full: ScenarioEnd;
  adherence: ScenarioEnd | null;
  capped: boolean;
}>;

export interface RaceCard {
  race: {
    name: string;
    date: string;
    priority: string;
    goalNote: string | null;
  } | null;
  daysOut: number | null;
  outlook: RaceOutlook | null;
}

const CAPPED_WHY =
  "Projection ends at plan end, before race day — it is not a race-day figure.";

const FULL_WHY = "Form outlook only: TSB from planned load, not readiness.";

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
  if (!race) return { race: null, daysOut: null, outlook: null };

  const assembled = await assembleForecastInputs(
    userId,
    race,
    now,
    preloadedWeek
  );

  let outlook: RaceOutlook;
  if (!assembled) {
    outlook = Figure.missingInput("an active training plan", {
      label: "Plan it",
      href: "/train?tab=week",
    });
  } else {
    const f = forecastForm(assembled.inputs);
    outlook = f.insufficient
      ? Figure.missingInput("training-load history")
      : Figure.available(
          { full: f.full, adherence: f.adherence, capped: f.capped },
          "low",
          f.capped ? CAPPED_WHY : FULL_WHY
        );
  }

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
  };
}

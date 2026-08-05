import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { schema } from "@/lib/db";
import type { Projected } from "@/lib/db/projected";
import { listRaces, stagesByRaceIds } from "@/lib/race/service";
import type { RaceStageDetail } from "@/lib/race/service";

const parameters = z.object({
  status: z.enum(["upcoming", "completed", "skipped"]).optional(),
  priority: z.enum(["A", "B", "C"]).optional(),
});

/**
 * Columns of `races` deliberately withheld from the coach. Every entry needs
 * a reason about coaching relevance — see `Projected`.
 */
type WithheldRaceColumn =
  // Server-side ownership key. Every row the coach sees already belongs to
  // the athlete it is talking to, and `upsert_race` addresses rows by `id`.
  | "userId"
  // Debrief-scheduler bookkeeping: whether the post-race writeup has been
  // posted yet. Says nothing about the event or the athlete's preparation.
  | "debriefedAt"
  // Row lifecycle. `date` is when the race happens; these are when the row
  // was typed in, which no coaching answer depends on.
  | "createdAt"
  | "updatedAt";

/**
 * `resultActivityId` is deliberately NOT withheld, against the spec's
 * provisional list. It is the athlete's actual ride/run for a completed
 * race, and it is the coach's only route from "how did Alpine Tour go?" to
 * `get_activity` — which is precisely the kind of question this release
 * exists to stop answering with less than we hold.
 */
type ProjectedRace = Projected<typeof schema.races, WithheldRaceColumn> & {
  daysToRace: number;
  stages: RaceStageDetail[];
};

function daysFromToday(ymd: string): number {
  const now = new Date();
  const today = new Date(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T00:00:00`
  );
  return Math.round(
    (new Date(ymd + "T00:00:00").getTime() - today.getTime()) / 86_400_000
  );
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const races = await listRaces(ctx.userId, args);
  const stages = await stagesByRaceIds(races.map((r) => r.id));
  return {
    races: races.map((r): ProjectedRace => ({
      id: r.id,
      name: r.name,
      raceType: r.raceType,
      sport: r.sport,
      date: r.date,
      priority: r.priority,
      status: r.status,
      goalNote: r.goalNote,
      eventDays: r.eventDays,
      distanceKm: r.distanceKm,
      elevationM: r.elevationM,
      demandHoursOverride: r.demandHoursOverride,
      resultActivityId: r.resultActivityId,
      daysToRace: daysFromToday(r.date),
      stages: stages.get(r.id) ?? [],
    })),
  };
}

export const getRacesTool: ToolDefinition<typeof parameters> = {
  name: "get_races",
  description:
    "List the athlete's races with everything on file for each: A/B/C priority, date, countdown in days, goal note, status, and what the event demands — the number of event days, total distance and elevation, the athlete's own weekly-hours override, and a `stages` array giving per-day number, name, distance and elevation. `stages` is empty BOTH for a one-day race AND for a multi-day event whose per-day detail has not been entered, so an empty array means no per-day detail is on file — never that the days are flat or easy. Check `eventDays` to tell the two apart. The races table is the source of truth for races — prefer it over memory.",
  parameters,
  execute,
};

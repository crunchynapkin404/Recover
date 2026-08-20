import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { racePacing } from "@/lib/race/pacing";
import { nextUpcomingRace, pacingAnchors } from "@/lib/race/service";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const race = await nextUpcomingRace(ctx.userId, new Date());
  if (!race) {
    return { success: true, available: false, reason: "no_upcoming_race" };
  }

  const anchors = await pacingAnchors(ctx.userId);
  const r = racePacing({
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

  const raceRef = { name: race.name, date: race.date, sport: race.sport };

  if (!r.available) {
    return {
      success: true,
      available: false,
      race: raceRef,
      reason: r.kind,
      // The athlete-facing sentence, not a code. The coach should be able to
      // say WHY there is no number, not just that there isn't one.
      why: r.kind === "not_applicable" ? r.why : null,
      needs: r.kind === "missing_input" ? r.needs : null,
    };
  }

  return {
    success: true,
    available: true,
    race: raceRef,
    ...r.value,
    confidence: r.confidence,
    why: r.why,
    note:
      "A target for a steady effort, not a segmented plan — this app has no " +
      "course profile, only total distance and total climbing.",
  };
}

export const getRacePacingTool: ToolDefinition<typeof parameters> = {
  name: "get_race_pacing",
  description:
    "How hard to go in the athlete's next race: a target power (bike) or pace " +
    "(run) with a band around it, the confidence, and the assumption behind " +
    "it. Returns a stated reason instead of a number for triathlon, multi-day " +
    "events, or a missing FTP/threshold pace.",
  parameters,
  execute,
};

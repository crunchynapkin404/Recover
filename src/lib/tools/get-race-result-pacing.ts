import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { racePacingResult } from "@/lib/race/service";

const parameters = z.object({
  race_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Race id (from get_races). Omit for the athlete's most recent race that has a result linked to it."
    ),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const result = await racePacingResult(ctx.userId, args.race_id);
  if (!result) {
    return {
      success: true,
      available: false,
      reason: args.race_id ? "race_not_found" : "no_raced_race",
    };
  }

  const { race, comparison } = result;
  const raceRef = {
    id: race.id,
    name: race.name,
    date: race.date,
    sport: race.sport,
    priority: race.priority,
  };

  if (!comparison.available) {
    return {
      success: true,
      available: false,
      race: raceRef,
      reason: comparison.kind,
      // The athlete-facing sentence, not a code — the coach should be able to
      // say WHY there is no comparison. Mirrors get_race_pacing exactly, so
      // the two tools refuse in the same shape.
      why: comparison.kind === "not_applicable" ? comparison.why : null,
      needs: comparison.kind === "missing_input" ? comparison.needs : null,
    };
  }

  return {
    success: true,
    available: true,
    race: raceRef,
    ...comparison.value,
    confidence: comparison.confidence,
    why: comparison.why,
    note:
      "`verdict` is in terms of EFFORT for both sports: 'harder' means above " +
      "the band, which for a run is a FASTER pace (a LOWER seconds-per-km). " +
      "`deltaSecPerKm` keeps its own units, so a positive value there is " +
      "slower and therefore easier.",
  };
}

export const getRaceResultPacingTool: ToolDefinition<typeof parameters> = {
  name: "get_race_result_pacing",
  description:
    "How a finished race actually went against the pacing target: the target " +
    "power (bike) or pace (run) and its band, what the athlete actually held, " +
    "the signed difference, and a verdict of harder/inside/easier in effort " +
    "terms. Defaults to the most recent race with a result linked to it; pass " +
    "race_id for a specific one. The target was NOT recorded before the start " +
    "— it is recomputed from the anchors that were on file on race day, and " +
    "`why` says so. Returns a stated reason instead of numbers when the race " +
    "has no result yet, when the result is a Strava activity (its numbers are " +
    "excluded from AI analysis under Strava's API agreement), when a bike " +
    "result carries no power, or when the recorded distance is too far from " +
    "the race's own to be the same event — a DNF or a mis-linked activity.",
  parameters,
  execute,
};

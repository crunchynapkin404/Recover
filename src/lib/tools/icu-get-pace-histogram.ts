/**
 * Time-in-zone pace distribution within a single running activity. Ported
 * from the standalone intervals-icu-mcp server's
 * activity_analysis.py:get_pace_histogram (GET
 * /activity/{id}/pace-histogram). Same bare-array `{min, max, secs}` bucket
 * shape as icu_get_hr_histogram (see that file's header for the
 * openapi-spec.json discrepancy). Pace units depend on the athlete's
 * configured pace units (see icu_get_sport_settings's paceUnits) — the
 * standalone leaves min/max unlabeled rather than guessing a unit, and we
 * follow that.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  activityId: z.string().describe("The intervals.icu activity ID."),
});

function shapeBucket(b: Record<string, unknown>) {
  return {
    min: (b.min as number | undefined) ?? null,
    max: (b.max as number | undefined) ?? null,
    timeS: typeof b.secs === "number" ? b.secs : 0,
  };
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(
    conn,
    `/activity/${args.activityId}/pace-histogram`
  )) as Array<Record<string, unknown>>;
  const buckets = raw.map(shapeBucket);
  return {
    activityId: args.activityId,
    buckets,
    totalTimeS: buckets.reduce((sum, b) => sum + b.timeS, 0),
  };
}

export const icuGetPaceHistogram: ToolDefinition<typeof parameters> = {
  name: "icu_get_pace_histogram",
  description:
    "Time-in-zone pace distribution within a single running activity — pace range buckets (in the athlete's configured pace units) with seconds spent in each. Different from icu_get_pace_curves (best efforts across many activities). Use for pace-distribution / consistency analysis. For elevation-normalized pace use icu_get_gap_histogram.",
  parameters,
  execute,
};

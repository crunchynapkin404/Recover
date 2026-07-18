/**
 * Time-in-zone grade-adjusted-pace (GAP) distribution within a single
 * activity — elevation-normalized. Ported from the standalone
 * intervals-icu-mcp server's activity_analysis.py:get_gap_histogram (GET
 * /activity/{id}/gap-histogram). Same bare-array `{min, max, secs}` bucket
 * shape as icu_get_hr_histogram (see that file's header for the
 * openapi-spec.json discrepancy).
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
    `/activity/${args.activityId}/gap-histogram`
  )) as Array<Record<string, unknown>>;
  const buckets = raw.map(shapeBucket);
  return {
    activityId: args.activityId,
    buckets,
    totalTimeS: buckets.reduce((sum, b) => sum + b.timeS, 0),
    note: "GAP (Grade Adjusted Pace) normalizes pace for elevation changes.",
  };
}

export const icuGetGapHistogram: ToolDefinition<typeof parameters> = {
  name: "icu_get_gap_histogram",
  description:
    "Time-in-zone distribution of grade-adjusted pace (GAP) within a single activity — elevation-normalized pace buckets with seconds spent in each. Use for trail running where raw pace is misleading. For raw (non-elevation-normalized) pace use icu_get_pace_histogram.",
  parameters,
  execute,
};

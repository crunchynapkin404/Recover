/**
 * Time-in-zone heart-rate distribution within a single activity. Ported
 * from the standalone intervals-icu-mcp server's
 * activity_analysis.py:get_hr_histogram (GET /activity/{id}/hr-histogram).
 *
 * The API returns a bare JSON array of `{min, max, secs}` buckets — NOT the
 * richer `{start, movingSecs, watts, hr, cadence}` shape openapi-spec.json's
 * Bucket schema documents. models.py:461's Bucket docstring records this
 * gap explicitly ("those fields are not actually populated by any of the
 * histogram endpoints"), and tests/test_histogram_tools.py's fixtures are
 * captioned as mirroring "the actual ... responses observed against the
 * live Intervals.icu API". We trim to exactly those 3 real fields per
 * bucket, matching tools/activity_analysis.py:get_hr_histogram's shaping
 * (hr_range{min_bpm,max_bpm} + time_seconds + total_time_seconds).
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
    minBpm: (b.min as number | undefined) ?? null,
    maxBpm: (b.max as number | undefined) ?? null,
    timeS: typeof b.secs === "number" ? b.secs : 0,
  };
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(
    conn,
    `/activity/${args.activityId}/hr-histogram`
  )) as Array<Record<string, unknown>>;
  const buckets = raw.map(shapeBucket);
  return {
    activityId: args.activityId,
    buckets,
    totalTimeS: buckets.reduce((sum, b) => sum + b.timeS, 0),
  };
}

export const icuGetHrHistogram: ToolDefinition<typeof parameters> = {
  name: "icu_get_hr_histogram",
  description:
    "Time-in-zone heart-rate distribution within a single activity — bpm range buckets with seconds spent in each. Different from icu_get_hr_curves (best efforts across many activities). Use for cardiovascular-load breakdown and HR-zone time-in-zone analysis.",
  parameters,
  execute,
};

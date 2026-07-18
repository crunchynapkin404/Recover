/**
 * Time-in-zone power distribution within a single activity. Ported from the
 * standalone intervals-icu-mcp server's
 * activity_analysis.py:get_power_histogram (GET
 * /activity/{id}/power-histogram). Same bare-array `{min, max, secs}`
 * bucket shape as icu_get_hr_histogram — see that file's header for the
 * openapi-spec.json Bucket-schema-vs-live-API discrepancy this deviates
 * from.
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
    minWatts: (b.min as number | undefined) ?? null,
    maxWatts: (b.max as number | undefined) ?? null,
    timeS: typeof b.secs === "number" ? b.secs : 0,
  };
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(
    conn,
    `/activity/${args.activityId}/power-histogram`
  )) as Array<Record<string, unknown>>;
  const buckets = raw.map(shapeBucket);
  return {
    activityId: args.activityId,
    buckets,
    totalTimeS: buckets.reduce((sum, b) => sum + b.timeS, 0),
  };
}

export const icuGetPowerHistogram: ToolDefinition<typeof parameters> = {
  name: "icu_get_power_histogram",
  description:
    "Time-in-zone power distribution within a single activity — watts range buckets with seconds spent in each. Different from icu_get_power_curves (best efforts across many activities). Use for 'how was my workout intensity distributed?' and training-zone breakdown.",
  parameters,
  execute,
};

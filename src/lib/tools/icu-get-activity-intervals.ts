/**
 * Per-lap / per-interval breakdown of one activity. Ported from the
 * standalone intervals-icu-mcp server's
 * activity_analysis.py:get_activity_intervals (GET /activity/{id}/intervals
 * -> IntervalsDTO.icu_intervals).
 *
 * Field names are shaped against openapi-spec.json's Interval schema
 * (elapsed_time, moving_time, average_watts, weighted_average_watts,
 * average_heartrate, max_heartrate, average_cadence, average_speed,
 * training_load, zone, start_index/end_index) — NOT the standalone's own
 * Interval pydantic model, which invents `start`/`end`/`duration`/
 * `target`/`target_min`/`target_max` fields absent from openapi-spec.json
 * (that model declares `extra="allow"`, so it silently accepts whatever the
 * live API actually returns rather than asserting a shape; its test
 * fixtures reflect the invented field names, not a documented live
 * response). This mirrors intervals.ts's existing fetchActivityIntervals
 * helper, which already targets the openapi field names for the same
 * endpoint.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  activityId: z.string().describe("The intervals.icu activity ID."),
});

function durationOf(iv: Record<string, unknown>): number | null {
  const elapsed = iv.elapsed_time;
  if (typeof elapsed === "number") return elapsed;
  const moving = iv.moving_time;
  return typeof moving === "number" ? moving : null;
}

function shapeInterval(iv: Record<string, unknown>) {
  return {
    id: iv.id ?? null,
    type: iv.type ?? null,
    label: iv.label ?? null,
    startIndex: iv.start_index ?? null,
    endIndex: iv.end_index ?? null,
    durationS: durationOf(iv),
    distanceM: iv.distance ?? null,
    avgWatts: iv.average_watts ?? null,
    normalizedWatts: iv.weighted_average_watts ?? null,
    avgHr: iv.average_heartrate ?? null,
    maxHr: iv.max_heartrate ?? null,
    avgCadence: iv.average_cadence ?? null,
    avgSpeed: iv.average_speed ?? null,
    trainingLoad: iv.training_load ?? null,
    zone: iv.zone ?? null,
  };
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(
    conn,
    `/activity/${args.activityId}/intervals`
  )) as { icu_intervals?: Array<Record<string, unknown>> };
  const rawIntervals = raw.icu_intervals ?? [];
  const intervals = rawIntervals.map(shapeInterval);
  const workIntervals = rawIntervals.filter((iv) => iv.type === "WORK");
  const recoveryIntervals = rawIntervals.filter((iv) => iv.type === "RECOVERY");
  const totalWorkDurationS = workIntervals.reduce((sum, iv) => {
    const d = durationOf(iv);
    return sum + (d ?? 0);
  }, 0);

  return {
    activityId: args.activityId,
    intervals,
    summary: {
      totalIntervals: intervals.length,
      workIntervals: workIntervals.length,
      recoveryIntervals: recoveryIntervals.length,
      totalWorkDurationS,
    },
  };
}

export const icuGetActivityIntervals: ToolDefinition<typeof parameters> = {
  name: "icu_get_activity_intervals",
  description:
    "Per-lap / per-interval breakdown of one activity — segment type (WORK/RECOVERY), duration, distance, average power/HR/cadence/speed, training load, zone. Use for workout-compliance analysis and lap-by-lap review. For headline summary metrics use icu_get_activity_details (existing); for raw second-by-second data use icu_get_activity_streams (existing).",
  parameters,
  execute,
};

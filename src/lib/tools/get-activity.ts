import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  id: z.string().uuid().describe("Activity id (from list_activities)."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const activity = await ctx.db.query.activities.findFirst({
    where: and(
      eq(schema.activities.id, args.id),
      eq(schema.activities.userId, ctx.userId),
      // Strava-sourced rows are excluded from AI/MCP surfaces (Strava API AI clause).
      ne(schema.activities.provider, "strava")
    ),
  });
  if (!activity) return { found: false };

  return {
    found: true,
    id: activity.id,
    date: activity.startDate.toISOString(),
    sport: activity.sport,
    name: activity.name,
    duration_min:
      activity.durationS != null ? Math.round(activity.durationS / 60) : null,
    distance_km:
      activity.distanceM != null
        ? +(activity.distanceM / 1000).toFixed(1)
        : null,
    training_load: activity.load,
    avg_hr: activity.avgHr,
    avg_power: activity.avgPower,
    elevation_m: activity.elevationM,
  };
}

export const getActivity: ToolDefinition<typeof parameters> = {
  name: "get_activity",
  description:
    "Get one activity's details (sport, duration, distance, load, HR, power, elevation) by id.",
  parameters,
  execute,
};

import { z } from "zod";
import { and, desc, eq, gte, isNotNull, ne } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";
import { weeklyActivitySummaries } from "@/lib/charts";

const parameters = z.object({
  weeks: z
    .union([z.literal(4), z.literal(12), z.literal(26)])
    .default(12)
    .describe(
      "Number of trailing Monday-based weeks to bucket (4, 12, or 26)."
    ),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const weeks = args.weeks ?? 12;
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7 - 6); // cover the first Monday

  const recent = await ctx.db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, ctx.userId),
      gte(schema.activities.startDate, since),
      // Strava-sourced rows are excluded from AI/MCP surfaces (Strava API AI clause).
      ne(schema.activities.provider, "strava")
    ),
    columns: { startDate: true, load: true, durationS: true, distanceM: true },
  });

  const latest = await ctx.db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, ctx.userId),
      isNotNull(schema.wellnessDaily.ctl)
    ),
    orderBy: desc(schema.wellnessDaily.date),
  });

  const ctl = latest?.ctl ?? null;
  const atl = latest?.atl ?? null;

  return {
    weeks: weeklyActivitySummaries(recent, weeks).map((w) => ({
      week_start: w.weekStart,
      load: Math.round(w.load),
      hours: +(w.durationS / 3600).toFixed(1),
      distance_km: +(w.distanceM / 1000).toFixed(1),
      sessions: w.sessions,
    })),
    current: {
      as_of: latest?.date ?? null,
      ctl_fitness: ctl,
      atl_fatigue: atl,
      tsb_form: ctl != null && atl != null ? +(ctl - atl).toFixed(1) : null,
    },
  };
}

export const getTrainingLoadSummary: ToolDefinition<typeof parameters> = {
  name: "get_training_load_summary",
  description:
    "Weekly training-load trend: Monday-based buckets of load, hours, distance, and session count for the trailing weeks, plus current CTL (fitness), ATL (fatigue), and TSB (form).",
  parameters,
  execute,
};

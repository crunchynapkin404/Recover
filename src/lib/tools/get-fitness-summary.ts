import { z } from "zod";
import { and, eq, gte } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const since = new Date();
  since.setDate(since.getDate() - 42); // 6 weeks for meaningful fitness summary
  const sinceStr = since.toISOString().slice(0, 10);

  const wellness = await ctx.db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, ctx.userId),
      gte(schema.wellnessDaily.date, sinceStr)
    ),
  });

  const latest = wellness.at(-1);
  const activities = await ctx.db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, ctx.userId),
      gte(schema.activities.startDate, since)
    ),
  });

  const totalLoad = activities.reduce((s, a) => s + (a.load ?? 0), 0);
  const totalDuration = activities.reduce((s, a) => s + (a.durationS ?? 0), 0);

  return {
    ctl: latest?.ctl ?? null,
    atl: latest?.atl ?? null,
    tsb: latest?.ctl != null && latest?.atl != null
      ? +(latest.ctl - latest.atl).toFixed(1)
      : null,
    eftp: latest?.eftp ?? null,
    period_days: 42,
    activity_count: activities.length,
    total_load: +totalLoad.toFixed(0),
    total_duration_hours: +(totalDuration / 3600).toFixed(1),
    sports: [...new Set(activities.map((a) => a.sport))],
  };
}

export const getFitnessSummary: ToolDefinition<typeof parameters> = {
  name: "get_fitness_summary",
  description:
    "Get a summary of the athlete's current fitness: CTL (chronic training load), ATL (acute), TSB (training stress balance), eFTP, activity count and total load over the past 6 weeks.",
  parameters,
  execute,
};

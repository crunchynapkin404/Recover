import { z } from "zod";
import { and, desc, eq, gte, isNotNull, ne } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({});

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const latest = await ctx.db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, ctx.userId),
      isNotNull(schema.wellnessDaily.ctl)
    ),
    orderBy: desc(schema.wellnessDaily.date),
  });

  const recent = await ctx.db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, ctx.userId),
      gte(schema.activities.startDate, new Date(`${daysAgo(28)}T00:00:00Z`)),
      // Strava-sourced rows are excluded from AI/MCP surfaces (Strava API AI clause).
      ne(schema.activities.provider, "strava")
    ),
    columns: { startDate: true, load: true, durationS: true },
  });

  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0));
  const week = daysAgo(7);
  const loads7 = recent
    .filter((a) => a.startDate.toISOString().slice(0, 10) >= week)
    .map((a) => a.load ?? 0);
  const loads28 = recent.map((a) => a.load ?? 0);
  const hours7 = recent
    .filter((a) => a.startDate.toISOString().slice(0, 10) >= week)
    .map((a) => (a.durationS ?? 0) / 3600);

  const ctl = latest?.ctl ?? null;
  const atl = latest?.atl ?? null;

  return {
    as_of: latest?.date ?? null,
    ctl_fitness: ctl,
    atl_fatigue: atl,
    tsb_form: ctl != null && atl != null ? +(ctl - atl).toFixed(1) : null,
    load_last_7d: sum(loads7),
    load_last_28d: sum(loads28),
    weekly_load_average_28d: Math.round(sum(loads28) / 4),
    hours_last_7d: +sum(hours7.map((h) => h * 10)) / 10,
    activities_last_7d: loads7.length,
  };
}

export const getTrainingLoadSummary: ToolDefinition<typeof parameters> = {
  name: "get_training_load_summary",
  description:
    "Get the athlete's training-load summary: CTL (fitness), ATL (fatigue), TSB (form), plus 7/28-day load totals, hours, and activity counts.",
  parameters,
  execute,
};

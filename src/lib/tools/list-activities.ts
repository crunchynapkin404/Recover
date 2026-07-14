import { z } from "zod";
import { and, eq, gte, desc, ne, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe("Number of days to look back for activities (max 30)."),
  sport: z
    .string()
    .optional()
    .describe("Filter by sport type (e.g. 'Ride', 'Run')."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("Maximum number of activities to return (max 20)."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const since = new Date();
  since.setDate(since.getDate() - args.days);

  // All filters in SQL so `limit` keeps its meaning: provenance exclusion
  // (Strava AI clause) and sport filtering must happen BEFORE the limit,
  // otherwise a page of Strava rows would mask older eligible activities.
  const conditions = [
    eq(schema.activities.userId, ctx.userId),
    gte(schema.activities.startDate, since),
    ne(schema.activities.provider, "strava"),
  ];
  if (args.sport) {
    conditions.push(
      sql`lower(${schema.activities.sport}) = ${args.sport.toLowerCase()}`
    );
  }

  const safe = await ctx.db.query.activities.findMany({
    where: and(...conditions),
    orderBy: desc(schema.activities.startDate),
    limit: args.limit,
  });

  return {
    activities: safe.map((a) => ({
      date: a.startDate.toISOString().slice(0, 10),
      sport: a.sport,
      name: a.name,
      duration_min: a.durationS != null ? +(a.durationS / 60).toFixed(0) : null,
      distance_km:
        a.distanceM != null ? +(a.distanceM / 1000).toFixed(1) : null,
      load: a.load != null ? +a.load.toFixed(0) : null,
      avg_hr: a.avgHr != null ? +a.avgHr.toFixed(0) : null,
      avg_power: a.avgPower != null ? +a.avgPower.toFixed(0) : null,
    })),
    count: safe.length,
  };
}

export const listActivities: ToolDefinition<typeof parameters> = {
  name: "list_activities",
  description:
    "List recent training activities with date, sport, name, duration, distance, load, avg HR, and avg power. Excludes Strava-sourced data per their AI clause.",
  parameters,
  execute,
};

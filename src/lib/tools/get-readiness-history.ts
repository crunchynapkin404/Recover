import { z } from "zod";
import { and, eq, gte, asc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(90)
    .default(7)
    .describe("Number of days of history to retrieve (max 90)."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const since = new Date();
  since.setDate(since.getDate() - args.days);
  const sinceStr = since.toISOString().slice(0, 10);

  const rows = await ctx.db.query.dailyMetrics.findMany({
    where: and(
      eq(schema.dailyMetrics.userId, ctx.userId),
      gte(schema.dailyMetrics.date, sinceStr)
    ),
    orderBy: asc(schema.dailyMetrics.date),
  });

  return {
    days: rows.map((r) => ({
      date: r.date,
      readiness: r.readiness,
      band: r.band,
      components: r.componentScores,
      tsb: r.tsb,
    })),
    count: rows.length,
  };
}

export const getReadinessHistory: ToolDefinition<typeof parameters> = {
  name: "get_readiness_history",
  description:
    "Get the athlete's readiness history for the past N days (default 7, max 90). Returns daily scores, bands, and component breakdowns.",
  parameters,
  execute,
};

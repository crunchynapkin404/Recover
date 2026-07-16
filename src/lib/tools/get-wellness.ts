import { z } from "zod";
import { and, eq, gte, desc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(7)
    .describe("Number of days of wellness data to retrieve (max 30)."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const since = new Date();
  since.setDate(since.getDate() - args.days);
  const sinceStr = since.toISOString().slice(0, 10);

  const rows = await ctx.db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, ctx.userId),
      gte(schema.wellnessDaily.date, sinceStr)
    ),
    orderBy: desc(schema.wellnessDaily.date),
  });

  return {
    days: rows.map((r) => ({
      date: r.date,
      hrv_ms: r.hrvMs,
      resting_hr: r.restingHr,
      sleep_hours:
        r.sleepSecs != null ? +(r.sleepSecs / 3600).toFixed(1) : null,
      sleep_score: r.sleepScore,
      ctl: r.ctl,
      atl: r.atl,
      weight_kg: r.weightKg,
      energy: r.energy1_10,
      soreness: r.soreness1_10,
      stress: r.stress1_10,
      // An athlete being ill/travelling materially changes the advice, and
      // these days are excluded from their baselines.
      day_flags: r.dayFlags ?? [],
    })),
    count: rows.length,
  };
}

export const getWellness: ToolDefinition<typeof parameters> = {
  name: "get_wellness",
  description:
    "Get the athlete's daily wellness data (HRV, resting HR, sleep, weight, subjective energy/soreness/stress, CTL/ATL) for the past N days.",
  parameters,
  execute,
};

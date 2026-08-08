import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getActivePlan } from "@/lib/active-plan";
import * as schema from "@/lib/db/schema";
import type { ToolContext, ToolDefinition } from "./registry";

const parameters = z.object({});

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const plan = await getActivePlan(ctx.userId);
  if (!plan) {
    return { status: "no_plan", message: "No active training plan yet." };
  }

  const blocks = await ctx.db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, plan.id),
    orderBy: desc(schema.trainingBlocks.weekNumber),
    limit: 4,
  });

  const scored = blocks.filter((block) => block.adherencePct != null);
  if (scored.length === 0) {
    return {
      planId: plan.id,
      planTitle: plan.title,
      status: "insufficient_data",
      message: "No completed weeks have adherence data yet.",
    };
  }

  const latest = scored[0];
  const previous = scored[1] ?? null;
  const rollingAdherencePct = mean(scored.map((block) => block.adherencePct!));
  const trendPct =
    previous?.adherencePct != null && latest.adherencePct != null
      ? Math.round(latest.adherencePct - previous.adherencePct)
      : null;

  const quality =
    trendPct != null && trendPct <= -5
      ? "slipping"
      : rollingAdherencePct != null && rollingAdherencePct >= 85 && trendPct != null && trendPct >= 5
        ? "improving"
        : rollingAdherencePct != null && rollingAdherencePct < 70
        ? "fragile"
        : "steady";

  return {
    planId: plan.id,
    planTitle: plan.title,
    latestWeekNumber: latest.weekNumber,
    latestAdherencePct: latest.adherencePct,
    rollingAdherencePct,
    trendPct,
    quality,
    status:
      quality === "improving"
        ? "good"
        : quality === "slipping"
          ? "risk"
          : quality === "fragile"
            ? "risk"
            : "steady",
  };
}

export const getRecommendationScorecard: ToolDefinition<typeof parameters> = {
  name: "get_recommendation_scorecard",
  description:
    "Get the current training plan scorecard, including recent adherence trend and whether recommendations appear improving, steady, slipping, or fragile.",
  parameters,
  execute,
};
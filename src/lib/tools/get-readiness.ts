import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const metric = await ctx.db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, ctx.userId),
    orderBy: desc(schema.dailyMetrics.date),
  });

  if (!metric) {
    return { status: "calibrating", message: "No readiness data yet." };
  }

  return {
    date: metric.date,
    readiness: metric.readiness,
    band: metric.band,
    components: metric.componentScores,
    tsb: metric.tsb,
  };
}

export const getReadiness: ToolDefinition<typeof parameters> = {
  name: "get_readiness",
  description:
    "Get the athlete's most recent readiness score, band (green/amber/red/calibrating), component breakdown (HRV, RHR, sleep, form), and TSB.",
  parameters,
  execute,
};

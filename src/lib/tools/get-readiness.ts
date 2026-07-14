import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  // Today's row often lacks HRV/RHR until the watch syncs mid-morning, so
  // fall back to the most recent SCORED day (within a week) rather than
  // reporting "calibrating" to an athlete with months of history.
  const recent = await ctx.db.query.dailyMetrics.findMany({
    where: eq(schema.dailyMetrics.userId, ctx.userId),
    orderBy: desc(schema.dailyMetrics.date),
    limit: 7,
  });

  if (recent.length === 0) {
    return { status: "calibrating", message: "No readiness data yet." };
  }

  const scored = recent.find((m) => m.readiness != null) ?? recent[0];
  const today = new Date().toISOString().slice(0, 10);

  return {
    date: scored.date,
    is_today: scored.date === today,
    readiness: scored.readiness,
    band: scored.band,
    components: scored.componentScores,
    tsb: scored.tsb,
    ...(scored.date !== today && {
      note: "Most recent scored day — today's HRV/RHR have not synced yet.",
    }),
  };
}

export const getReadiness: ToolDefinition<typeof parameters> = {
  name: "get_readiness",
  description:
    "Get the athlete's most recent readiness score, band (green/amber/red/calibrating), component breakdown (HRV, RHR, sleep, form), and TSB.",
  parameters,
  execute,
};

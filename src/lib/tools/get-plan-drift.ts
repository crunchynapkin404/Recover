import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { and, asc, eq } from "drizzle-orm";
import { getOpenWeekPlan, listAdjustments } from "@/lib/week-plan/service";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, ctx.userId),
      eq(schema.trainingPlans.status, "active")
    ),
  });
  if (!plan) return { available: false, reason: "no_active_plan" };

  const blocks = await db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, plan.id),
    orderBy: [asc(schema.trainingBlocks.weekNumber)],
  });
  const past = blocks.filter(
    (b) => b.actualLoad != null && (b.targetLoadTotal ?? 0) > 0
  );
  const weeks = past.map((b) => ({
    week: b.weekNumber,
    phase: b.phase,
    targetLoad: b.targetLoadTotal,
    actualLoad: b.actualLoad,
    adherencePct: b.adherencePct,
  }));

  // Open week: effective vs skeleton target, sourced from its
  // weekly_rollover adjustments (deterministic reasons, never re-derived).
  const open = await getOpenWeekPlan(ctx.userId);
  let openWeek: {
    weekStart: string;
    skeletonWeek: number;
    skeletonTarget: number | null;
    rolloverReasons: string[];
  } | null = null;
  if (open) {
    const rollover = (await listAdjustments(open.id)).filter(
      (a) => a.trigger === "weekly_rollover"
    );
    openWeek = {
      weekStart: open.weekStart,
      skeletonWeek: open.skeletonWeek,
      skeletonTarget:
        blocks.find((b) => b.weekNumber === open.skeletonWeek)
          ?.targetLoadTotal ?? null,
      rolloverReasons: rollover.map((a) => a.reason),
    };
  }

  // Computed summary — never phrased by an LLM.
  let summary: string;
  if (weeks.length === 0) {
    summary = "no completed plan weeks yet — no drift to report";
  } else {
    const totalTarget = past.reduce((s, b) => s + (b.targetLoadTotal ?? 0), 0);
    const totalActual = past.reduce((s, b) => s + (b.actualLoad ?? 0), 0);
    const pct = Math.round(((totalActual - totalTarget) / totalTarget) * 100);
    summary =
      pct === 0
        ? `actual load matched the skeleton over the last ${weeks.length} week(s)`
        : `actual load ran ${Math.abs(pct)}% ${pct < 0 ? "under" : "over"} the skeleton over the last ${weeks.length} week(s)`;
  }

  return { available: true, weeks, openWeek, summary };
}

export const getPlanDriftTool: ToolDefinition<typeof parameters> = {
  name: "get_plan_drift",
  description:
    "Compare planned (skeleton) vs actual load per completed plan week, plus the open week's effective target — quantifies how far training has drifted from the plan.",
  parameters,
  execute,
};

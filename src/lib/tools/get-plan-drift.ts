import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { asc, eq } from "drizzle-orm";
import { getOpenWeekPlan, listAdjustments } from "@/lib/week-plan/service";
import { getActivePlan } from "@/lib/active-plan";
import { weekTargetLoad } from "@/lib/week-plan/volume";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const plan = await getActivePlan(ctx.userId);
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

  // Open week: its own effective target (post-taper, post-hours-budget)
  // once materialized, falling back to the block's skeleton value — the
  // "effective target" this tool's description promises, via the one
  // shared read path (week-plan/volume.ts's weekTargetLoad()). Deliberately
  // different from `past`/`totalTarget` below, which compare against the
  // ORIGINAL skeleton on purpose: this tool measures drift FROM the
  // skeleton, so using the already-adjusted figure there would hide
  // exactly the drift it exists to report.
  const open = await getOpenWeekPlan(ctx.userId);
  let openWeek: {
    weekStart: string;
    skeletonWeek: number;
    effectiveTarget: number | null;
    rolloverReasons: string[];
  } | null = null;
  if (open) {
    const rollover = (await listAdjustments(open.id)).filter(
      (a) => a.trigger === "weekly_rollover"
    );
    const resolved = weekTargetLoad({
      effectiveTarget: open.effectiveTarget,
      blockTarget:
        blocks.find((b) => b.weekNumber === open.skeletonWeek)
          ?.targetLoadTotal ?? null,
    });
    openWeek = {
      weekStart: open.weekStart,
      skeletonWeek: open.skeletonWeek,
      effectiveTarget: resolved.available ? resolved.value : null,
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

import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import type { ToolDefinition, ToolContext } from "./registry";
import { schema } from "@/lib/db";
import { getOpenWeekPlan, listAdjustments } from "@/lib/week-plan/service";
import { fuellingFromSession } from "@/lib/fuelling/from-session";
import type { DaySlot } from "@/lib/week-plan/types";
import { resolvePlanStyle } from "@/lib/plan-style/resolve";
import { normalizeSeasonState } from "@/lib/season-mode/resolve";

const parameters = z.object({});

export function mapDaysWithFuelling(
  days: DaySlot[],
  bodyMassKg: number | null
) {
  return days.map((d) => ({
    date: d.date,
    availableBlocks: d.availableBlocks,
    workouts: d.workouts.map((w) => ({
      ...w,
      fuelling: fuellingFromSession(w, bodyMassKg),
    })),
    status: d.status,
    movedFrom: d.movedFrom ?? null,
  }));
}

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const week = await getOpenWeekPlan(ctx.userId);
  if (!week) return { active: false };
  const recentWellness = await ctx.db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, ctx.userId),
    orderBy: desc(schema.wellnessDaily.date),
    limit: 30,
  });
  const bodyMassKg =
    recentWellness.find((w) => w.weightKg != null)?.weightKg ?? null;
  const adjustments = await listAdjustments(week.id);
  const plan = await ctx.db.query.trainingPlans.findFirst({
    where: eq(schema.trainingPlans.id, week.planId),
    columns: { constraints: true },
  });
  const effectiveStyle = resolvePlanStyle(
    (plan?.constraints as { planStyle?: unknown } | null)?.planStyle
  );
  const seasonState = normalizeSeasonState({
    seasonMode: (plan?.constraints as { seasonMode?: unknown } | null)
      ?.seasonMode,
    reentryStage: (plan?.constraints as { reentryStage?: unknown } | null)
      ?.reentryStage,
  });
  return {
    active: true,
    weekStart: week.weekStart,
    skeletonWeek: week.skeletonWeek,
    effectiveStyle,
    effectiveSeasonMode: seasonState.seasonMode,
    reentryStage: seasonState.reentryStage,
    fuellingBodyMassKg: bodyMassKg,
    days: mapDaysWithFuelling(week.days, bodyMassKg),
    adjustments: adjustments.map((a) => ({ date: a.date, reason: a.reason })),
  };
}

export const getWeekPlanTool: ToolDefinition<typeof parameters> = {
  name: "get_week_plan",
  description:
    "Get the current materialized week: each day's workouts (or rest), availability, completion status, session fuelling guidance, and every automatic adjustment with its reason.",
  parameters,
  execute,
};

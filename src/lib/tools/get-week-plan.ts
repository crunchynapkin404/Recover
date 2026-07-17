import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { getOpenWeekPlan, listAdjustments } from "@/lib/week-plan/service";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const week = await getOpenWeekPlan(ctx.userId);
  if (!week) return { active: false };
  const adjustments = await listAdjustments(week.id);
  return {
    active: true,
    weekStart: week.weekStart,
    skeletonWeek: week.skeletonWeek,
    days: week.days.map((d) => ({
      date: d.date,
      availableMins: d.availableMins,
      workout: d.workout,
      status: d.status,
      movedFrom: d.movedFrom ?? null,
    })),
    adjustments: adjustments.map((a) => ({ date: a.date, reason: a.reason })),
  };
}

export const getWeekPlanTool: ToolDefinition<typeof parameters> = {
  name: "get_week_plan",
  description:
    "Get the current materialized week: each day's workout (or rest), availability, completion status, and every automatic adjustment with its reason.",
  parameters,
  execute,
};

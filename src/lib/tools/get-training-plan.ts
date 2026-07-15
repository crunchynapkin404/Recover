import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { and, eq, asc } from "drizzle-orm";

const parameters = z.object({
  weekNumber: z
    .number()
    .int()
    .optional()
    .describe("Specific week to detail. Omit for plan overview."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, ctx.userId),
      eq(schema.trainingPlans.status, "active")
    ),
  });
  if (!plan) return { available: false, reason: "no_active_plan" };

  if (args.weekNumber != null) {
    const block = await db.query.trainingBlocks.findFirst({
      where: and(
        eq(schema.trainingBlocks.planId, plan.id),
        eq(schema.trainingBlocks.weekNumber, args.weekNumber)
      ),
    });
    if (!block) return { available: false, reason: "week_not_found" };
    return {
      available: true,
      plan: {
        id: plan.id,
        title: plan.title,
        raceType: plan.raceType,
        raceDate: plan.raceDate,
        weeksTotal: plan.weeksTotal,
        currentWeek: plan.currentWeek,
      },
      week: block,
    };
  }

  const blocks = await db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, plan.id),
    orderBy: [asc(schema.trainingBlocks.weekNumber)],
  });
  return {
    available: true,
    plan: {
      id: plan.id,
      title: plan.title,
      raceType: plan.raceType,
      raceDate: plan.raceDate,
      startDate: plan.startDate,
      weeksTotal: plan.weeksTotal,
      currentWeek: plan.currentWeek,
      targetCtl: plan.targetCtl,
      startingCtl: plan.startingCtl,
      status: plan.status,
    },
    weeks: blocks.map((b) => ({
      week: b.weekNumber,
      phase: b.phase,
      targetLoad: b.targetLoadTotal,
      targetSessions: b.targetSessions,
      actualLoad: b.actualLoad,
      adherencePct: b.adherencePct,
    })),
  };
}

export const getTrainingPlanTool: ToolDefinition<typeof parameters> = {
  name: "get_training_plan",
  description:
    "Get the active training plan overview, or detail a specific week's workouts.",
  parameters,
  execute,
};

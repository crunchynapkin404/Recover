import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

const parameters = z.object({
  weekNumber: z.number().int().describe("Week to adjust."),
  action: z.enum(["reduce_load", "increase_load", "swap_rest_day", "skip_week", "extend"])
    .describe("Adjustment type."),
  reason: z.string().describe("Why the adjustment is being made."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, ctx.userId),
      eq(schema.trainingPlans.status, "active"),
    ),
  });
  if (!plan) return { success: false, error: "no_active_plan" };

  const block = await db.query.trainingBlocks.findFirst({
    where: and(
      eq(schema.trainingBlocks.planId, plan.id),
      eq(schema.trainingBlocks.weekNumber, args.weekNumber),
    ),
  });
  if (!block) return { success: false, error: "week_not_found" };

  let newLoad = block.targetLoadTotal ?? 0;
  const notes = `${args.action}: ${args.reason}`;

  switch (args.action) {
    case "reduce_load": newLoad *= 0.7; break;
    case "increase_load": newLoad *= 1.1; break;
    case "skip_week": newLoad = 0; break;
    case "swap_rest_day":
    case "extend":
      // These modify the workout structure — for now just add a note
      break;
  }

  await db.update(schema.trainingBlocks)
    .set({ targetLoadTotal: Math.round(newLoad), notes })
    .where(eq(schema.trainingBlocks.id, block.id));

  return { success: true, weekNumber: args.weekNumber, action: args.action, newTargetLoad: Math.round(newLoad), notes };
}

export const updateTrainingPlanTool: ToolDefinition<typeof parameters> = {
  name: "update_training_plan",
  description: "Adjust a training plan week — reduce/increase load, swap rest day, skip week, or extend.",
  parameters,
  scope: "write:plan",
  execute,
};

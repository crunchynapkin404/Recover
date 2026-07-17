import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { moveWorkout, swapWorkouts } from "@/lib/week-plan/service";

const WEEK_ACTIONS = ["reduce_load", "increase_load", "skip_week"] as const;
const DAY_ACTIONS = ["move_workout", "swap_workout"] as const;

const parameters = z
  .object({
    weekNumber: z
      .number()
      .int()
      .optional()
      .describe("Week to adjust (required for week-level actions)."),
    action: z
      .enum([...WEEK_ACTIONS, ...DAY_ACTIONS])
      .describe(
        "Week-level: adjusts the week's target load. Day-level (move_workout/swap_workout): rearranges the current week's days."
      ),
    reason: z.string().describe("Why the adjustment is being made."),
    fromDate: z
      .string()
      .optional()
      .describe("YYYY-MM-DD — source day (day-level actions)."),
    toDate: z
      .string()
      .optional()
      .describe("YYYY-MM-DD — target day (day-level actions)."),
  })
  .superRefine((v, ctx) => {
    if (
      (WEEK_ACTIONS as readonly string[]).includes(v.action) &&
      v.weekNumber == null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weekNumber"],
        message: "weekNumber is required for week-level actions",
      });
    }
    if (
      (DAY_ACTIONS as readonly string[]).includes(v.action) &&
      (!v.fromDate || !v.toDate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fromDate"],
        message: "fromDate and toDate are required for day-level actions",
      });
    }
  });

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  if ((DAY_ACTIONS as readonly string[]).includes(args.action)) {
    const result =
      args.action === "move_workout"
        ? await moveWorkout(ctx.userId, args.fromDate!, args.toDate!)
        : await swapWorkouts(ctx.userId, args.fromDate!, args.toDate!);
    if (result === "moved" || result === "swapped") {
      return {
        success: true,
        action: args.action,
        fromDate: args.fromDate,
        toDate: args.toDate,
        reason: args.reason,
      };
    }
    return { success: false, error: result };
  }

  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, ctx.userId),
      eq(schema.trainingPlans.status, "active")
    ),
  });
  if (!plan) return { success: false, error: "no_active_plan" };

  const block = await db.query.trainingBlocks.findFirst({
    where: and(
      eq(schema.trainingBlocks.planId, plan.id),
      eq(schema.trainingBlocks.weekNumber, args.weekNumber!)
    ),
  });
  if (!block) return { success: false, error: "week_not_found" };

  let newLoad = block.targetLoadTotal ?? 0;
  const notes = `${args.action}: ${args.reason}`;

  switch (args.action) {
    case "reduce_load":
      newLoad *= 0.7;
      break;
    case "increase_load":
      newLoad *= 1.1;
      break;
    case "skip_week":
      newLoad = 0;
      break;
  }

  await db
    .update(schema.trainingBlocks)
    .set({ targetLoadTotal: Math.round(newLoad), notes })
    .where(eq(schema.trainingBlocks.id, block.id));

  return {
    success: true,
    weekNumber: args.weekNumber,
    action: args.action,
    newTargetLoad: Math.round(newLoad),
    notes,
  };
}

export const updateTrainingPlanTool: ToolDefinition<typeof parameters> = {
  name: "update_training_plan",
  description:
    "Adjust the training plan — week-level: reduce/increase load or skip a week; day-level: move or swap workouts within the current week.",
  parameters,
  scope: "write:plan",
  execute,
};

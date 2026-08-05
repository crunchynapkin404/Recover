import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { confirmTrainingPlan } from "@/lib/training-plan";

const parameters = z.object({
  planId: z
    .string()
    .uuid()
    .describe("The draft plan id returned by generate_training_plan."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const result = await confirmTrainingPlan(ctx.userId, args.planId);
  if (!result.ok) {
    return {
      success: false,
      error:
        "That draft is no longer available — generate a fresh plan to review.",
    };
  }
  return { success: true, planId: result.planId };
}

export const confirmTrainingPlanTool: ToolDefinition<typeof parameters> = {
  name: "confirm_training_plan",
  description:
    "Activate a draft training plan the athlete has reviewed. Archives their " +
    "previous plan. Only call this after the athlete has explicitly agreed to " +
    "the proposed plan.",
  parameters,
  scope: "write:plan",
  execute,
};

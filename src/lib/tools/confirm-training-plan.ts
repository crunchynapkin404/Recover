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
    // Written here rather than read from REFUSAL_TEXT deliberately: that record
    // is keyed on previewTrainingPlan's three refusal reasons, and "not_found"
    // is not one of them. Do not "fix" this into a REFUSAL_TEXT lookup — it
    // would not typecheck, and the sentence a confirmation needs is different
    // anyway (the draft expired, so start again; nothing about bad input).
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

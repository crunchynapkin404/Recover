import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { confirmTrainingPlan } from "@/lib/training-plan";

const parameters = z.object({
  planId: z
    .string()
    .uuid()
    .describe("The draft plan id returned by generate_training_plan."),
});

// Written here rather than read from REFUSAL_TEXT deliberately: that record
// is keyed on previewTrainingPlan's three refusal reasons, and neither of
// confirmTrainingPlan's own reasons ("not_found", "sport_changed") is one of
// those. Do not "fix" this into a REFUSAL_TEXT lookup — it would not
// typecheck, and the sentences a confirmation needs are different anyway.
const CONFIRM_REFUSAL_TEXT: Record<
  Extract<
    Awaited<ReturnType<typeof confirmTrainingPlan>>,
    { ok: false }
  >["reason"],
  string
> = {
  not_found:
    "That draft is no longer available — generate a fresh plan to review.",
  // Finding 1 (v0.43 final review): the race this draft was built for has
  // since been corrected to a different sport, so the plan the athlete
  // reviewed no longer matches the race it targets.
  sport_changed:
    "The race this plan was built for has since changed sport, so this plan no longer matches it. Ask for a fresh plan for the race as it stands now.",
};

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const result = await confirmTrainingPlan(ctx.userId, args.planId);
  if (!result.ok) {
    return {
      success: false,
      error: CONFIRM_REFUSAL_TEXT[result.reason],
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

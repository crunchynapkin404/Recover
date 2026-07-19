import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { generateTrainingPlan } from "@/lib/training-plan";

const parameters = z.object({
  raceType: z
    .enum([
      "marathon",
      "half_marathon",
      "10k",
      "5k",
      "ultra",
      "ironman",
      "70.3",
      "olympic_tri",
      "sprint_tri",
      "gran_fondo",
      "century",
      "crit",
      "general_fitness",
    ])
    .describe("Type of target race or training goal."),
  raceDate: z.string().describe("Target race date (YYYY-MM-DD)."),
  title: z
    .string()
    .optional()
    .describe("Plan name, e.g. 'Berlin Marathon 2026'."),
  daysPerWeek: z
    .number()
    .int()
    .min(3)
    .max(7)
    .default(5)
    .describe("Training days per week (3-7)."),
  hoursPerWeek: z
    .number()
    .min(3)
    .max(25)
    .default(8)
    .describe("Available training hours per week."),
  sports: z
    .array(z.string())
    .optional()
    .describe("Override sports list. Defaults to athlete profile."),
  raceId: z
    .string()
    .uuid()
    .optional()
    .describe("Target an existing race instead of creating one."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  try {
    const result = await generateTrainingPlan({
      userId: ctx.userId,
      ...args,
    });
    return {
      success: true,
      planId: result.planId,
      summary: result.summary,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Plan generation failed",
    };
  }
}

export const generateTrainingPlanTool: ToolDefinition<typeof parameters> = {
  name: "generate_training_plan",
  description:
    "Generate a periodized multi-week training plan targeting a race or fitness goal. " +
    "Uses current fitness (CTL), available time, and sport-science periodization rules.",
  parameters,
  scope: "write:plan",
  execute,
};

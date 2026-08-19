import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { previewTrainingPlan } from "@/lib/training-plan";
import { REFUSAL_TEXT } from "@/lib/plan-preview";

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
  planStyle: z
    .enum(["balanced", "block_lite"])
    .optional()
    .describe("Optional planning style preference."),
  seasonMode: z
    .enum(["normal", "off_season"])
    .optional()
    .describe("Optional season mode (normal or off-season maintenance)."),
  raceId: z
    .string()
    .uuid()
    .optional()
    .describe("Target an existing race instead of creating one."),
  secondRaceId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "A second A-priority race later in the season. The plan builds a full arc to the first race, a recovery bridge, then a rebuild and taper to this one. Both races must be A-priority and upcoming."
    ),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  // Omitting secondRaceId must keep today's contract byte-identical, so the
  // single-raceId call still passes straight through as `...rest` did before
  // this parameter existed. Only when a second target is given does the call
  // switch to the two-race `raceIds` form previewTrainingPlan added.
  const { secondRaceId, ...rest } = args;
  const result = await previewTrainingPlan(
    secondRaceId
      ? {
          userId: ctx.userId,
          ...rest,
          raceIds: [rest.raceId, secondRaceId].filter(
            (id): id is string => id != null
          ),
        }
      : { userId: ctx.userId, ...rest }
  );
  if (!result.ok) {
    return {
      success: false,
      reason: result.reason,
      error: REFUSAL_TEXT[result.reason],
    };
  }
  return { success: true, preview: result.preview };
}

export const generateTrainingPlanTool: ToolDefinition<typeof parameters> = {
  name: "generate_training_plan",
  description:
    "Propose a periodized multi-week training plan targeting a race or fitness goal, " +
    "using current fitness (CTL), available time, and sport-science periodization rules. " +
    "Optionally target a second A-race later in the season with secondRaceId — both races " +
    "must be A-priority and upcoming, and the plan builds a full arc to the first race, a " +
    "recovery bridge, then a rebuild and taper to the second. " +
    "This only DRAFTS a plan for the athlete to review — it does not activate anything, " +
    "archive their existing plan, or touch their calendar. Show the athlete the returned " +
    "preview and ask them to confirm before calling confirm_training_plan.",
  parameters,
  scope: "write:plan",
  execute,
};

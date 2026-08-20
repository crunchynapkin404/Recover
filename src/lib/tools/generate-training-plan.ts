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

/**
 * Refusals this TOOL owns, as distinct from previewTrainingPlan's.
 *
 * Same reasoning as confirm-training-plan.ts's CONFIRM_REFUSAL_TEXT: these
 * are malformed tool ARGUMENTS, not plan-domain refusals, so they do not
 * belong in the closed PreviewResult union and could not be keyed off
 * REFUSAL_TEXT. Both are input that can only be a mistake, which is this
 * design's stated bar for a named refusal rather than a silent reinterpretation.
 */
const TOOL_REFUSAL_TEXT = {
  second_race_without_first:
    "A second race was given with no first race. Pass raceId for the earlier A-race as well, or ask for a single-race plan targeting just this one.",
  same_race_twice:
    "raceId and secondRaceId name the same race. A two-race season needs two different A-races.",
} as const;

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  // Omitting secondRaceId must keep today's contract byte-identical, so the
  // single-raceId call still passes straight through as `...rest` did before
  // this parameter existed. Only when a second target is given does the call
  // switch to the two-race `raceIds` form previewTrainingPlan added.
  const { secondRaceId, ...rest } = args;

  // Guard BEFORE previewTrainingPlan, because both of these would otherwise
  // resolve to something plausible and wrong: a lone secondRaceId collapses
  // to a single-race plan targeting it (the one-id branch runs no priority
  // check), and the same id twice refuses as `race_not_found`, whose sentence
  // -- "That race is not on your calendar any more" -- is simply untrue.
  if (secondRaceId && !rest.raceId) {
    return {
      success: false as const,
      reason: "second_race_without_first" as const,
      error: TOOL_REFUSAL_TEXT.second_race_without_first,
    };
  }
  if (secondRaceId && secondRaceId === rest.raceId) {
    return {
      success: false as const,
      reason: "same_race_twice" as const,
      error: TOOL_REFUSAL_TEXT.same_race_twice,
    };
  }
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

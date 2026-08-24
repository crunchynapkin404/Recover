import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  strengthPrescription,
  oneRmsFromBodyPrefs,
} from "@/lib/strength/prescription";
import { PLAN_PHASES, type PlanPhase } from "@/lib/plan-phase";

const parameters = z.object({
  phase: z
    .enum(PLAN_PHASES)
    .describe("Which periodization phase to prescribe for."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const prefs = await ctx.db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, ctx.userId),
  });

  const oneRms = oneRmsFromBodyPrefs(prefs);
  const anyMaxesSet = oneRms != null;

  return {
    success: true,
    phase: args.phase as PlanPhase,
    exercises: strengthPrescription(args.phase, oneRms),
    // Named rather than implied: a client showing sets and reps with no
    // weights should be able to say why, not just render blanks.
    anyMaxesSet,
    note: anyMaxesSet
      ? "Weight targets come from the athlete's own 1RMs. A lift with no " +
        "1RM set returns sets and reps with a null target rather than a " +
        "guessed weight."
      : "No 1RMs are set, so every weight target is null. Sets and reps " +
        "still reflect the phase.",
  };
}

export const getStrengthPrescriptionTool: ToolDefinition<typeof parameters> = {
  name: "get_strength_prescription",
  description:
    "The athlete's structured strength prescription for a given " +
    "periodization phase: sets, reps and a target weight per lift, derived " +
    "from their own one-rep maxima. Returns a null weight rather than a " +
    "guess for any lift whose 1RM is not set.",
  parameters,
  execute,
};

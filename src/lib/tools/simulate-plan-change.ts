import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { simulatePlanChange, type PlanChange } from "@/lib/race/forecast";
import { assembleForecastInputs, nextUpcomingRace } from "@/lib/race/service";
import { getOpenWeekPlan } from "@/lib/week-plan/service";

const parameters = z
  .object({
    action: z.enum(["move", "swap", "skip"]),
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    toDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action !== "skip" && !v.toDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toDate"],
        message: "toDate is required for move/swap",
      });
    }
  });

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const week = await getOpenWeekPlan(ctx.userId);
  if (!week) return { success: false, error: "no_open_week" };
  const from = week.days.find((d) => d.date === args.fromDate);
  if (!from?.workout) return { success: false, error: "no_workout_on_from" };

  const race = await nextUpcomingRace(ctx.userId);
  const assembled = await assembleForecastInputs(ctx.userId, race);
  if (!assembled) return { success: false, error: "no_active_plan" };

  const change: PlanChange =
    args.action === "skip"
      ? { kind: "skip", fromDate: args.fromDate }
      : { kind: args.action, fromDate: args.fromDate, toDate: args.toDate! };
  const r = simulatePlanChange(assembled.inputs, change);
  if (r.before.insufficient || r.after.insufficient) {
    return {
      success: true,
      insufficient: true,
      note: "CTL/ATL not calibrated yet — no projection to compare. This is a preview only; nothing was saved.",
    };
  }
  return {
    success: true,
    anchor: assembled.race
      ? { race: assembled.race.name, date: assembled.race.date }
      : { race: null, date: assembled.inputs.targetDate },
    capped: r.before.capped,
    before: r.before.full,
    after: r.after.full,
    deltaTsb: r.deltaTsb,
    loadDelta: r.loadDelta,
    note: "Projection (form outlook from TSB only). This tool never saves — use update_training_plan to apply the change.",
  };
}

export const simulatePlanChangeTool: ToolDefinition<typeof parameters> = {
  name: "simulate_plan_change",
  description:
    "Preview what moving/swapping/skipping a planned session does to projected race-day form (TSB) WITHOUT saving. Read-only what-if.",
  parameters,
  execute,
};

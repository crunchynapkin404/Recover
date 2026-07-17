import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { applyAvailability, getOpenWeekPlan } from "@/lib/week-plan/service";

const parameters = z.object({
  availableMins: z
    .array(z.number().int().min(0).max(720))
    .length(7)
    .describe("Minutes available per day, Monday first"),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const result = await applyAvailability(ctx.userId, args.availableMins);
  if (result !== "applied") return { applied: false, reason: result };
  const week = await getOpenWeekPlan(ctx.userId);
  return {
    applied: true,
    week: week
      ? {
          weekStart: week.weekStart,
          days: week.days.map((d) => ({
            date: d.date,
            availableMins: d.availableMins,
            workout: d.workout,
            status: d.status,
          })),
        }
      : null,
  };
}

export const setWeekAvailabilityTool: ToolDefinition<typeof parameters> = {
  name: "set_week_availability",
  description:
    "Update the athlete's available minutes per day for the current week; non-completed days rematerialize around the new availability and the change is logged.",
  parameters,
  scope: "write:plan",
  execute,
};

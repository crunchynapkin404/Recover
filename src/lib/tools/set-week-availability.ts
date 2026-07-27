import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { applyAvailability, getOpenWeekPlan } from "@/lib/week-plan/service";
import type { AvailabilityBlock } from "@/lib/availability/types";

const blockSchema = z.object({
  start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  mins: z.number().int().min(0).max(720),
  energy: z.enum(["easy", "normal", "full"]),
  sports: z.array(z.string()).nullable(),
});

const parameters = z
  .object({
    availableBlocks: z
      .array(z.array(blockSchema))
      .length(7)
      .optional()
      .describe("Time blocks per day, Monday first"),
    availableMins: z
      .array(z.number().int().min(0).max(720))
      .length(7)
      .optional()
      .describe("Legacy: total minutes per day, Monday first"),
  })
  .refine((v) => v.availableBlocks != null || v.availableMins != null, {
    message: "Provide availableBlocks or availableMins",
  });

/** A plain number becomes one untimed block — same meaning, new shape. */
function toBlocks(args: z.infer<typeof parameters>): AvailabilityBlock[][] {
  if (args.availableBlocks)
    return args.availableBlocks as AvailabilityBlock[][];
  return (args.availableMins ?? []).map((mins) =>
    mins > 0
      ? [
          {
            start: null,
            end: null,
            mins,
            energy: "normal" as const,
            sports: null,
          },
        ]
      : []
  );
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const result = await applyAvailability(ctx.userId, toBlocks(args));
  if (result !== "applied") return { applied: false, reason: result };
  const week = await getOpenWeekPlan(ctx.userId);
  return {
    applied: true,
    week: week
      ? {
          weekStart: week.weekStart,
          days: week.days.map((d) => ({
            date: d.date,
            availableBlocks: d.availableBlocks,
            workouts: d.workouts,
            status: d.status,
          })),
        }
      : null,
  };
}

export const setWeekAvailabilityTool: ToolDefinition<typeof parameters> = {
  name: "set_week_availability",
  description:
    "Update the athlete's availability for the current week as time blocks (or legacy minutes per day). Displaced sessions move, shorten, or are substituted — the rest of the week stays put.",
  parameters,
  scope: "write:plan",
  execute,
};

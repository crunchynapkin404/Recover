import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { applyAvailability, getOpenWeekPlan } from "@/lib/week-plan/service";
import {
  validateBlocks,
  type AvailabilityBlock,
} from "@/lib/availability/types";
import { syncDateOverrides } from "@/lib/availability/sync-overrides";
import { availabilityBlockSchema } from "./availability-block-schema";

/** Days are Monday-first, matching the tool's own weekday indexing. */
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const parameters = z
  .object({
    availableBlocks: z
      .array(z.array(availabilityBlockSchema))
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
  const blocks = toBlocks(args);
  for (let i = 0; i < blocks.length; i++) {
    const invalid = validateBlocks(blocks[i]);
    if (invalid) {
      return {
        applied: false,
        reason: `${WEEKDAY_NAMES[i] ?? `day ${i}`}: ${invalid}`,
      };
    }
  }
  // Pin the dates first, exactly as submitAvailability does. Without this the
  // open week's jsonb changes but nothing is recorded in availability_overrides,
  // so the coach's change is invisible to resolveWeek and dies at the next
  // rematerialization -- the athlete's identical edit would survive.
  await syncDateOverrides(ctx.userId, blocks);

  const result = await applyAvailability(ctx.userId, blocks);
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

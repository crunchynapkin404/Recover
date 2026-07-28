import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { applyResolvedAvailability } from "@/lib/week-plan/service";
import {
  validateBlocks,
  type AvailabilityBlock,
} from "@/lib/availability/types";
import { availabilityBlockSchema } from "./availability-block-schema";

const parameters = z.object({
  weekday: z.number().int().min(0).max(6).describe("0 = Monday"),
  blocks: z
    .array(availabilityBlockSchema)
    .describe("Time blocks; an empty list means a rest day"),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const blocks = args.blocks as AvailabilityBlock[];
  const invalid = validateBlocks(blocks);
  if (invalid) return { applied: false, reason: invalid };

  await db
    .insert(schema.availabilityDefaults)
    .values({ userId: ctx.userId, weekday: args.weekday, blocks })
    .onConflictDoUpdate({
      target: [
        schema.availabilityDefaults.userId,
        schema.availabilityDefaults.weekday,
      ],
      set: { blocks, updatedAt: new Date() },
    });

  // Same reason the server action does it: the standard week is what
  // resolveWeek reads, so without replanning, the open week's stored days
  // keep availability the athlete no longer has. Overrides still win.
  await applyResolvedAvailability(ctx.userId);
  return { applied: true, weekday: args.weekday, blocks };
}

export const setStandardWeekTool: ToolDefinition<typeof parameters> = {
  name: "set_standard_week",
  description:
    "Set one weekday of the athlete's standard weekly availability. Dates the athlete has already pinned keep their pinned value — this only changes weekdays that follow the default.",
  parameters,
  scope: "write:plan",
  execute,
};

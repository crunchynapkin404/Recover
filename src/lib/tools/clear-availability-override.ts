import { z } from "zod";
import { and, eq } from "drizzle-orm";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";

const parameters = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("YYYY-MM-DD"),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const deleted = await db
    .delete(schema.availabilityOverrides)
    .where(
      and(
        eq(schema.availabilityOverrides.userId, ctx.userId),
        eq(schema.availabilityOverrides.date, args.date)
      )
    )
    .returning();
  return { cleared: deleted.length > 0, date: args.date };
}

export const clearAvailabilityOverrideTool: ToolDefinition<typeof parameters> =
  {
    name: "clear_availability_override",
    description:
      "Remove the athlete's pinned availability for one date, so that date follows the standard week again.",
    parameters,
    scope: "write:plan",
    execute,
  };

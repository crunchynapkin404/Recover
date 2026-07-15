import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { fetchPlannedWorkouts } from "@/lib/connectors/intervals";

const parameters = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(14)
    .default(7)
    .describe("Look-ahead window in days (1-14)."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  // Find intervals.icu connection
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, ctx.userId),
      eq(schema.connections.provider, "intervals_icu"),
      eq(schema.connections.status, "active")
    ),
  });
  if (!connection) {
    return { available: false, reason: "no_connection" };
  }

  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + args.days * 86400000)
    .toISOString()
    .slice(0, 10);

  try {
    const workouts = await fetchPlannedWorkouts({
      apiKey: decrypt(connection.encryptedAccessToken),
      athleteId: connection.externalAthleteId,
      startDate,
      endDate,
    });
    return {
      available: true,
      days: args.days,
      startDate,
      endDate,
      workouts,
      count: workouts.length,
    };
  } catch {
    return { available: false, reason: "fetch_failed" };
  }
}

export const getPlannedWorkouts: ToolDefinition<typeof parameters> = {
  name: "get_planned_workouts",
  description:
    "Get upcoming planned workouts from the athlete's intervals.icu calendar. " +
    "Shows what training is scheduled in the next 1-14 days.",
  parameters,
  execute,
};

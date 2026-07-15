import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import {
  fetchBusyTimes,
  getValidGoogleAccessToken,
} from "@/lib/connectors/google-calendar";

const parameters = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(7)
    .default(3)
    .describe("Look-ahead window (1-7 days)."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, ctx.userId),
      eq(schema.connections.provider, "google_calendar"),
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
    const accessToken = await getValidGoogleAccessToken(connection);
    const busyBlocks = await fetchBusyTimes({
      accessToken,
      startDate,
      endDate,
    });
    return {
      available: true,
      days: args.days,
      startDate,
      endDate,
      busyBlocks,
      count: busyBlocks.length,
    };
  } catch {
    return { available: false, reason: "fetch_failed" };
  }
}

export const getCalendarAvailability: ToolDefinition<typeof parameters> = {
  name: "get_calendar_availability",
  description:
    "Get the athlete's busy/free blocks from Google Calendar for the next 1-7 days. " +
    "Use to schedule training around work and life commitments.",
  parameters,
  execute,
};

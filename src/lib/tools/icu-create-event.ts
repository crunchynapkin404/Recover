import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import { buildIcuEventBody, icuEventOptionalFields } from "./icu-event-body";
import { shapeIcuEvent } from "./icu-event-shape";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  date: z.string().describe("Start date, YYYY-MM-DD."),
  category: z
    .string()
    .describe(
      "Event category: WORKOUT, NOTE, RACE_A, RACE_B, RACE_C, TARGET, PLAN, HOLIDAY, SICK, INJURED, SET_EFTP, FITNESS_DAYS, SEASON_START, SET_FITNESS."
    ),
  name: z.string().describe("Event name."),
  ...icuEventOptionalFields,
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const body = buildIcuEventBody(args);
  const raw = (await icuRequest(conn, "/athlete/{id}/events", {
    method: "POST",
    body,
  })) as Record<string, unknown>;
  return { event: shapeIcuEvent(raw) };
}

export const icuCreateEvent: ToolDefinition<typeof parameters> = {
  name: "icu_create_event",
  description:
    "Create ONE new calendar event (planned workout, note, race, etc.) on the athlete's intervals.icu calendar. For 2+ events, prefer icu_bulk_create_events. For copying an existing event forward in time, use icu_duplicate_events.",
  parameters,
  scope: "write:icu",
  execute,
};

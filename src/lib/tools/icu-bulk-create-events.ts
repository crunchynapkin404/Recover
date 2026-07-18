import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import { buildIcuEventBody, icuEventOptionalFields } from "./icu-event-body";
import { shapeIcuEvent } from "./icu-event-shape";
import type { ToolDefinition, ToolContext } from "./registry";

const eventInput = z.object({
  date: z.string().describe("Start date, YYYY-MM-DD."),
  category: z.string().describe("Event category, e.g. WORKOUT, NOTE, RACE_A."),
  name: z.string().describe("Event name."),
  ...icuEventOptionalFields,
});

const parameters = z.object({
  events: z
    .array(eventInput)
    .min(1)
    .describe("Events to create in a single batch call."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const body = args.events.map((e) => buildIcuEventBody(e));
  const raw = (await icuRequest(conn, "/athlete/{id}/events/bulk", {
    method: "POST",
    body,
  })) as Array<Record<string, unknown>>;
  const events = raw.map((e) => shapeIcuEvent(e));
  return { events, count: events.length };
}

export const icuBulkCreateEvents: ToolDefinition<typeof parameters> = {
  name: "icu_bulk_create_events",
  description:
    "Create MANY new calendar events on intervals.icu in a single batch call (more efficient than looping icu_create_event). For copying existing events forward, use icu_duplicate_events instead.",
  parameters,
  scope: "write:icu",
  execute,
};

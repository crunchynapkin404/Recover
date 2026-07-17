import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import { buildIcuEventBody, icuEventOptionalFields } from "./icu-event-body";
import { shapeIcuEvent } from "./icu-event-shape";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  eventId: z.number().int().describe("The intervals.icu event ID to update."),
  date: z.string().optional().describe("Updated start date, YYYY-MM-DD."),
  category: z.string().optional().describe("Updated event category."),
  name: z.string().optional().describe("Updated event name."),
  ...icuEventOptionalFields,
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const { eventId, ...fields } = args;
  const body = buildIcuEventBody(fields);
  if (Object.keys(body).length === 0) {
    return { error: "No fields provided to update." };
  }
  const raw = (await icuRequest(conn, `/athlete/{id}/events/${eventId}`, {
    method: "PUT",
    body,
  })) as Record<string, unknown>;
  return { event: shapeIcuEvent(raw) };
}

export const icuUpdateEvent: ToolDefinition<typeof parameters> = {
  name: "icu_update_event",
  description:
    "Update an existing intervals.icu calendar event. Only fields you pass are sent — other fields remain unchanged.",
  parameters,
  scope: "write:icu",
  execute,
};

import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import { shapeIcuEvent } from "./icu-event-shape";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  eventId: z.number().int().describe("The intervals.icu event ID."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(
    conn,
    `/athlete/{id}/events/${args.eventId}`
  )) as Record<string, unknown>;
  return { event: shapeIcuEvent(raw) };
}

export const icuGetEvent: ToolDefinition<typeof parameters> = {
  name: "icu_get_event",
  description:
    "Fetch ONE specific calendar event by ID from intervals.icu — full details including description, metrics, and fitness context.",
  parameters,
  execute,
};

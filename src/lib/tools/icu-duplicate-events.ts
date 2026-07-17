import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import { shapeIcuEvent } from "./icu-event-shape";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  eventIds: z
    .array(z.number().int())
    .min(1)
    .describe("Event IDs to duplicate forward in time."),
  numCopies: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Number of copies to create per event."),
  weeksBetween: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Weeks between each copy."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  // intervals.icu has a dedicated server-side duplicate-events endpoint
  // (client.py:duplicate_events / openapi DuplicateEventsDTO) that copies
  // and shifts dates itself — no client-side fetch+shift+bulk-create step,
  // and no dayOffset field (the brief's table described a shape that
  // doesn't match the actual API).
  const raw = (await icuRequest(conn, "/athlete/{id}/duplicate-events", {
    method: "POST",
    body: {
      eventIds: args.eventIds,
      numCopies: args.numCopies,
      weeksBetween: args.weeksBetween,
    },
  })) as Array<Record<string, unknown>>;
  const events = raw.map((e) => shapeIcuEvent(e));
  return { events, duplicatedCount: events.length };
}

export const icuDuplicateEvents: ToolDefinition<typeof parameters> = {
  name: "icu_duplicate_events",
  description:
    "Copy existing intervals.icu calendar events forward in time, N copies spaced weeksBetween weeks apart. Use for 'repeat this workout for the next 4 weeks'. Reuses the existing events' payloads — for building new events from scratch use icu_create_event / icu_bulk_create_events.",
  parameters,
  scope: "write:icu",
  execute,
};

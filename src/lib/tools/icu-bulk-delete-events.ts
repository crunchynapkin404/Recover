import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  eventIds: z
    .array(z.number().int())
    .min(1)
    .describe("Event IDs to delete in a single batch call."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  // intervals.icu's bulk-delete endpoint is PUT with a body of [{id}, ...]
  // (client.py:bulk_delete_events / openapi DoomedEvent schema) — NOT the
  // POST /events/bulk-delete + {eventIds} shape a first pass at this table
  // might suggest.
  const raw = (await icuRequest(conn, "/athlete/{id}/events/bulk-delete", {
    method: "PUT",
    body: args.eventIds.map((id) => ({ id })),
  })) as { eventsDeleted?: number } | null;
  return { deleted: args.eventIds, deletedCount: raw?.eventsDeleted ?? 0 };
}

export const icuBulkDeleteEvents: ToolDefinition<typeof parameters> = {
  name: "icu_bulk_delete_events",
  description:
    "Delete MANY calendar events on intervals.icu in a single batch call. Destructive — cannot be undone.",
  parameters,
  scope: "write:icu",
  execute,
};

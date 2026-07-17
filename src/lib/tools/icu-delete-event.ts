import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  eventId: z.number().int().describe("The intervals.icu event ID to delete."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  await icuRequest(conn, `/athlete/{id}/events/${args.eventId}`, {
    method: "DELETE",
  });
  return { deleted: args.eventId };
}

export const icuDeleteEvent: ToolDefinition<typeof parameters> = {
  name: "icu_delete_event",
  description:
    "Permanently delete ONE calendar event by ID from intervals.icu. Destructive — cannot be undone.",
  parameters,
  scope: "write:icu",
  execute,
};

/**
 * Read the notes/comments attached to an intervals.icu activity. Ported from
 * the standalone intervals-icu-mcp server's
 * activity_messages.py:get_activity_messages (GET /activity/{id}/messages),
 * response shaped per _message_to_dict + openapi-spec.json's Message schema.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  activityId: z.string().describe("The intervals.icu activity ID."),
});

function shapeMessage(m: Record<string, unknown>) {
  return {
    id: m.id,
    athleteId: m.athlete_id ?? null,
    name: m.name ?? null,
    type: m.type ?? null,
    content: m.content ?? null,
    created: m.created ?? null,
    seen: m.seen ?? null,
    attachmentUrl: m.attachment_url ?? null,
  };
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(
    conn,
    `/activity/${args.activityId}/messages`
  )) as Array<Record<string, unknown>>;
  const messages = raw.map(shapeMessage);
  return { activityId: args.activityId, messages, count: messages.length };
}

export const icuGetActivityMessages: ToolDefinition<typeof parameters> = {
  name: "icu_get_activity_messages",
  description:
    "Read the notes and comments attached to a specific intervals.icu activity (plural = READ), in chronological order — author, content, timestamp, seen-flag. To POST a new message use icu_add_activity_message (singular = WRITE).",
  parameters,
  execute,
};

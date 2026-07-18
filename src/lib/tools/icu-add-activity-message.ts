/**
 * Post a new note/comment on an intervals.icu activity. Ported from the
 * standalone intervals-icu-mcp server's activity_messages.py:add_activity_message
 * (POST /activity/{id}/messages, body {content}), verified against
 * openapi-spec.json's NewActivityMsg (request) / NewMsg (response: {id,
 * new_chat}) schemas.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  activityId: z.string().describe("The intervals.icu activity ID."),
  content: z.string().describe("Message content (note or comment text)."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  if (!args.content.trim()) {
    return { error: "content must not be empty" };
  }
  const raw = (await icuRequest(conn, `/activity/${args.activityId}/messages`, {
    method: "POST",
    body: { content: args.content },
  })) as Record<string, unknown>;
  return { activityId: args.activityId, messageId: raw?.id ?? null };
}

export const icuAddActivityMessage: ToolDefinition<typeof parameters> = {
  name: "icu_add_activity_message",
  description:
    "POST a new note or comment on a specific intervals.icu activity (singular = WRITE). Use when the user wants to leave a note on one of their activities. To READ existing notes use icu_get_activity_messages (plural).",
  parameters,
  scope: "write:icu",
  execute,
};

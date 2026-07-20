import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { searchHistory, RECALL_MAX_LIMIT } from "@/lib/recall";

const parameters = z.object({
  query: z
    .string()
    .min(2)
    .describe(
      "Plain search words. Quoted phrases and -exclusions supported (websearch syntax)."
    ),
  limit: z.number().int().min(1).max(RECALL_MAX_LIMIT).optional(),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const hits = await searchHistory(ctx.db, {
    userId: ctx.userId,
    query: args.query,
    limit: args.limit,
    excludeThreadId: ctx.threadId,
  });
  if (hits.length === 0) {
    return {
      hits: [],
      note: "No matches in past conversations or journal notes. Tell the athlete you found nothing — do not improvise a memory.",
    };
  }
  return { hits };
}

export const recallHistoryTool: ToolDefinition<typeof parameters> = {
  name: "recall_history",
  description:
    "Full-text search over the athlete's past conversations, weekly/monthly reviews, ride debriefs, and journal notes. Use when the athlete refers to something from the past. Cite results with their dates and quote them; if empty, say you found nothing.",
  parameters,
  execute,
};

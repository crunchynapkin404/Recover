/**
 * Search activities by name, or by exact tag if the query is prefixed with
 * '#'. Ported from the standalone intervals-icu-mcp server's
 * activities.py:search_activities / client.py:search_activities (GET
 * /athlete/{id}/activities/search), fields verified against
 * openapi-spec.json's ActivitySearchResult schema (id, name,
 * start_date_local, type, race, distance, moving_time, tags, description).
 *
 * Deviation: client.py fetches every match then slices `results[:limit]`
 * client-side. openapi-spec.json documents `limit` as a real, optional
 * server-side query parameter on this endpoint (alongside required `q`), so
 * we pass it straight through instead of over-fetching and truncating.
 */
import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  q: z
    .string()
    .min(1)
    .describe(
      "Search query — case-insensitive activity name search, or exact tag match if prefixed with '#'."
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of results to return."),
});

function shapeResult(a: Record<string, unknown>) {
  return {
    id: a.id,
    name: a.name ?? null,
    date: a.start_date_local ?? null,
    type: a.type ?? null,
    distanceM: a.distance ?? null,
    durationS: a.moving_time ?? null,
    race: a.race ?? null,
    tags: a.tags ?? null,
  };
}

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(conn, "/athlete/{id}/activities/search", {
    query: { q: args.q, limit: args.limit },
  })) as Array<Record<string, unknown>>;
  const activities = raw.map(shapeResult);
  return { query: args.q, activities, count: activities.length };
}

export const icuSearchActivities: ToolDefinition<typeof parameters> = {
  name: "icu_search_activities",
  description:
    "Search activities by name or tag — LIGHT result list (id, name, type, date, distance, duration, tags) only. Prefix the query with '#' for an exact tag match. Use icu_get_activity_details (existing) for full metrics on a specific match.",
  parameters,
  execute,
};

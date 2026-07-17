import { z } from "zod";
import { icuRequest } from "@/lib/connectors/intervals";
import { activeIcuConnection } from "./icu-connection";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({
  oldest: z.string().describe("Start date, YYYY-MM-DD"),
  newest: z.string().describe("End date, YYYY-MM-DD"),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const conn = await activeIcuConnection(ctx);
  if (!conn) return { error: "No active intervals.icu connection" };
  const raw = (await icuRequest(conn, "/athlete/{id}/events", {
    query: { oldest: args.oldest, newest: args.newest },
  })) as Array<Record<string, unknown>>;
  return {
    events: raw.map((e) => ({
      id: e.id,
      date: e.start_date_local,
      category: e.category,
      name: e.name,
      description: e.description ?? null,
    })),
  };
}

export const icuGetCalendarEvents: ToolDefinition<typeof parameters> = {
  name: "icu_get_calendar_events",
  description:
    "List events (planned workouts, notes, races) on your intervals.icu calendar between two dates.",
  parameters,
  execute,
};

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { getBestEffortsCached } from "@/lib/athlete-curves";

const parameters = z.object({
  days: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .default(90)
    .describe("Trailing window in days (30, 90, or 365)."),
  sport: z
    .string()
    .optional()
    .describe("Filter by sport type (e.g. 'Ride', 'Run')."),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const result = await getBestEffortsCached(ctx.userId, { days: args.days });
  if (!result.available) return result;
  const efforts = args.sport
    ? result.data.filter(
        (e) => e.sport.toLowerCase() === args.sport!.toLowerCase()
      )
    : result.data;
  return {
    available: true,
    stale: result.stale,
    fetched_at: result.fetchedAt,
    days: args.days,
    efforts,
    count: efforts.length,
  };
}

export const getBestEfforts: ToolDefinition<typeof parameters> = {
  name: "get_best_efforts",
  description:
    "List the athlete's best efforts (PRs) in the trailing window — label, sport, value, unit, date — as computed by intervals.icu.",
  parameters,
  execute,
};

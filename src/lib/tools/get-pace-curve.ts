import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { getCurves } from "@/lib/athlete-curves";
import type { IntervalsPaceCurve } from "@/lib/connectors/intervals";
import { pickCanonical, capSeries } from "./curve-format";

const parameters = z.object({
  days: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .default(90)
    .describe("Trailing window in days (30, 90, or 365)."),
});

const CANONICAL_DISTANCES_M = [400, 1000, 5000, 10000, 21097];

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const result = await getCurves(ctx.userId, "pace", { days: args.days });
  if (!result.available) return result;
  const curve = result.data as IntervalsPaceCurve;
  return {
    available: true,
    stale: result.stale,
    fetched_at: result.fetchedAt,
    days: args.days,
    key_points: pickCanonical(
      curve.distanceM,
      curve.secsPerKm,
      CANONICAL_DISTANCES_M
    ).map((p) => ({
      distance_m: p.x,
      secs_per_km: +p.y.toFixed(1),
    })),
    curve: (() => {
      const { x, y } = capSeries(curve.distanceM, curve.secsPerKm);
      return { distance_m: x, secs_per_km: y.map((s) => +s.toFixed(1)) };
    })(),
  };
}

export const getPaceCurve: ToolDefinition<typeof parameters> = {
  name: "get_pace_curve",
  description:
    "Get the athlete's running pace curve (best pace per distance, secs/km) from intervals.icu, with key points at 400m/1k/5k/10k/half. Running PRs live here.",
  parameters,
  execute,
};

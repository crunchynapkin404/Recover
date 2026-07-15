import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { getCurves } from "@/lib/athlete-curves";
import type { IntervalsPowerCurve } from "@/lib/connectors/intervals";
import { pickCanonical, capSeries } from "./curve-format";

const parameters = z.object({
  days: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .default(90)
    .describe("Trailing window in days (30, 90, or 365)."),
});

const CANONICAL_SECS = [5, 60, 300, 1200, 3600];

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const result = await getCurves(ctx.userId, "power", { days: args.days });
  if (!result.available) return result;
  const curve = result.data as IntervalsPowerCurve;
  return {
    available: true,
    stale: result.stale,
    fetched_at: result.fetchedAt,
    days: args.days,
    key_points: pickCanonical(curve.secs, curve.watts, CANONICAL_SECS).map(
      (p) => ({ duration_s: p.x, watts: Math.round(p.y) })
    ),
    curve: (() => {
      const { x, y } = capSeries(curve.secs, curve.watts);
      return { secs: x, watts: y.map((w) => Math.round(w)) };
    })(),
  };
}

export const getPowerCurve: ToolDefinition<typeof parameters> = {
  name: "get_power_curve",
  description:
    "Get the athlete's mean-max power curve (best average watts per duration) from intervals.icu, with key points at 5s/1m/5m/20m/60m. Cycling power PRs live here.",
  parameters,
  execute,
};

import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { ToolDefinition, ToolContext } from "./registry";
import {
  describeActivityOnStrava,
  stravaIdFromRaw,
} from "@/lib/strava-describer";
import { getValidStravaAccessToken } from "@/lib/sync/strava-sync";

const parameters = z.object({
  activityId: z
    .string()
    .optional()
    .describe("Strava activity ID. Omit to describe the most recent activity."),
  style: z
    .string()
    .optional()
    .describe(
      "Custom instructions for the description format. Reserved: v0.6 always writes the default metrics template."
    ),
});

async function execute(args: z.infer<typeof parameters>, ctx: ToolContext) {
  const connection = await ctx.db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, ctx.userId),
      eq(schema.connections.provider, "strava"),
      eq(schema.connections.status, "active")
    ),
  });
  if (!connection) {
    return { written: false, reason: "Strava is not connected." };
  }
  if (!connection.stravaWriteEnabled) {
    return {
      written: false,
      reason:
        "The Strava connection lacks write access — reconnect via Settings → Strava to grant it.",
    };
  }

  // Candidates come from intervals.icu only (Strava data is never AI input).
  const recent = await ctx.db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, ctx.userId),
      eq(schema.activities.provider, "intervals_icu")
    ),
    orderBy: [desc(schema.activities.startDate)],
    limit: 50,
  });
  const linked = recent.filter(
    (a) => stravaIdFromRaw(a.raw as Record<string, unknown> | null) != null
  );
  const target = args.activityId
    ? linked.find(
        (a) =>
          stravaIdFromRaw(a.raw as Record<string, unknown> | null) ===
          args.activityId
      )
    : linked[0];
  if (!target) {
    return {
      written: false,
      reason: args.activityId
        ? "No intervals.icu activity is linked to that Strava ID."
        : "No recent activity has a linked Strava ID.",
    };
  }

  const accessToken = await getValidStravaAccessToken(connection);
  const outcome = await describeActivityOnStrava({
    userId: ctx.userId,
    activity: target,
    accessToken,
  });

  // Only the generated block goes back to the model — the merged text may
  // contain the user's existing Strava description (Strava API AI clause).
  return {
    written: outcome.wrote,
    activity: {
      name: target.name,
      sport: target.sport,
      date: target.startDate.toISOString().slice(0, 10),
    },
    description: outcome.generated,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(args.style
      ? {
          note: "Custom styles ship in a later release; the default metrics template was written.",
        }
      : {}),
  };
}

export const describeStravaActivityTool: ToolDefinition<typeof parameters> = {
  name: "describe_strava_activity",
  description:
    "Push a data-dense metrics description (built from intervals.icu data only) onto the athlete's Strava activity. Appends below any existing description; skips if already described by Recover.",
  parameters,
  scope: "write:strava",
  execute,
};

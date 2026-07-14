import { z } from "zod";
import { and, eq, desc, gte } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { ToolDefinition, ToolContext } from "./registry";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const user = await ctx.db.query.users.findFirst({
    where: eq(schema.users.id, ctx.userId),
  });

  if (!user) return { error: "User not found" };

  const connection = await ctx.db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, ctx.userId),
      eq(schema.connections.provider, "intervals_icu")
    ),
  });

  // Recent wellness for body composition
  const latestWellness = await ctx.db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, ctx.userId),
    orderBy: desc(schema.wellnessDaily.date),
  });

  // Activity sport distribution (last 90 days)
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const activities = await ctx.db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, ctx.userId),
      gte(schema.activities.startDate, since)
    ),
  });
  const sportCounts: Record<string, number> = {};
  for (const a of activities) {
    sportCounts[a.sport] = (sportCounts[a.sport] ?? 0) + 1;
  }

  return {
    name: user.name,
    connected_provider: connection
      ? {
          provider: connection.provider,
          athlete_name: connection.externalAthleteName,
          status: connection.status,
          last_sync: connection.lastSyncAt?.toISOString() ?? null,
        }
      : null,
    weight_kg: latestWellness?.weightKg ?? null,
    eftp: latestWellness?.eftp ?? null,
    sports_90d: sportCounts,
    total_activities_90d: activities.length,
  };
}

export const getAthleteProfile: ToolDefinition<typeof parameters> = {
  name: "get_athlete_profile",
  description:
    "Get the athlete's profile: name, connected provider, weight, eFTP, and sport distribution over the last 90 days.",
  parameters,
  execute,
};

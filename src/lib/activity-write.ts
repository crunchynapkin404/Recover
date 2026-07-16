import { db, schema } from "@/lib/db";

export interface ActivityWriteInput {
  sport: string;
  name?: string;
  startDate: string; // YYYY-MM-DD
  durationMinutes?: number;
  distanceKm?: number;
  load?: number;
  avgHr?: number;
  avgPower?: number;
  elevationM?: number;
}

export async function createManualActivity(
  userId: string,
  input: ActivityWriteInput
): Promise<{ activityId: string }> {
  const externalId = `manual-${Date.now()}`;
  const [row] = await db
    .insert(schema.activities)
    .values({
      userId,
      provider: "manual",
      externalId,
      sport: input.sport,
      name: input.name || `${input.sport} session`,
      startDate: new Date(input.startDate),
      durationS:
        input.durationMinutes != null
          ? Math.round(input.durationMinutes * 60)
          : null,
      distanceM:
        input.distanceKm != null
          ? Math.round(input.distanceKm * 1000)
          : null,
      load: input.load ?? null,
      avgHr: input.avgHr ?? null,
      avgPower: input.avgPower ?? null,
      elevationM: input.elevationM ?? null,
    })
    .returning();
  return { activityId: row.id };
}

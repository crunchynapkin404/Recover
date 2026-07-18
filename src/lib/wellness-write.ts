import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { computeDailyMetrics } from "@/lib/metrics";
import type { DayFlag } from "@/lib/day-flags";

/**
 * Fields that also exist in the v0.11 provider merge (wellness-merge.ts).
 * Manual writes stamp these as manually owned so a later Whoop/Oura/
 * intervals sync can never overwrite what the athlete typed on purpose.
 */
const PRIORITY_MANAGED = [
  "hrvMs",
  "restingHr",
  "sleepSecs",
  "weightKg",
] as const;

export interface WellnessWriteInput {
  date: string; // YYYY-MM-DD
  sleepSecs?: number;
  weightKg?: number;
  energy1_10?: number;
  soreness1_10?: number;
  stress1_10?: number;
  hrvMs?: number;
  restingHr?: number;
  mood?: string;
  tags?: string[];
  dayFlags?: DayFlag[];
  notes?: string;
}

/**
 * Merge-not-overwrite wellness upsert shared by the journal form action and
 * the log_wellness tool: only provided fields are written, then readiness is
 * recomputed from the changed date onward.
 */
export async function upsertWellness(
  userId: string,
  input: WellnessWriteInput
): Promise<{ fieldsWritten: number }> {
  const values: Partial<typeof schema.wellnessDaily.$inferInsert> = {};
  if (input.sleepSecs != null) values.sleepSecs = Math.round(input.sleepSecs);
  if (input.weightKg != null) values.weightKg = input.weightKg;
  if (input.energy1_10 != null) values.energy1_10 = input.energy1_10;
  if (input.soreness1_10 != null) values.soreness1_10 = input.soreness1_10;
  if (input.stress1_10 != null) values.stress1_10 = input.stress1_10;
  if (input.hrvMs != null) values.hrvMs = input.hrvMs;
  if (input.restingHr != null) values.restingHr = input.restingHr;
  if (input.mood != null) values.mood = input.mood;
  if (input.tags != null) values.tags = input.tags;
  if (input.dayFlags != null) values.dayFlags = input.dayFlags;
  if (input.notes != null) values.notes = input.notes;

  const fieldsWritten = Object.keys(values).length;
  if (fieldsWritten === 0) return { fieldsWritten: 0 };

  const stamped = PRIORITY_MANAGED.filter((f) => values[f] != null);
  if (stamped.length > 0) {
    const existing = await db.query.wellnessDaily.findFirst({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        eq(schema.wellnessDaily.date, input.date)
      ),
      columns: { fieldSources: true },
    });
    values.fieldSources = {
      ...(existing?.fieldSources ?? {}),
      ...Object.fromEntries(stamped.map((f) => [f, "manual"])),
    };
  }

  await db
    .insert(schema.wellnessDaily)
    .values({
      userId,
      date: input.date,
      source: "manual",
      ...values,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.wellnessDaily.userId, schema.wellnessDaily.date],
      set: { ...values, updatedAt: new Date() },
    });

  await computeDailyMetrics(userId, input.date);
  return { fieldsWritten };
}

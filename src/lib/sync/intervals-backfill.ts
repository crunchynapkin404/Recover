/**
 * v0.36 wellness history backfill.
 *
 * Two independent losses, both invisible to the daily sync:
 *
 * Phase A — every wellness row stores the provider's full payload in `raw`,
 * but the columns were written by whatever mapping existed at sync time. v0.33
 * added mappings for steps, spO2, vo2max, sleepQuality, sleeping HR, body fat
 * and hydration, and only the 7-day incremental overlap ever flowed through
 * them. The data is already local; it just needs re-mapping.
 *
 * Phase B — the first sync was capped at 365 days and every sync since has
 * re-fetched a 7-day overlap, so everything before that cap was never fetched.
 *
 * Both phases write through `applyWellnessPatch`, so a backfilled day is
 * indistinguishable from a synced one and can never outrank a better source.
 */
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { normalizeWellnessRow } from "@/lib/connectors/intervals";
import { wellnessDayToPatch } from "@/lib/sync/intervals-sync";
import { applyWellnessPatch } from "@/lib/wellness-merge";

/**
 * Phase A: re-map payloads already stored in `wellness_daily.raw`.
 *
 * No network calls. Returns how many rows actually changed and the oldest
 * changed date, which the caller feeds to `computeDailyMetrics`.
 */
export async function remapStoredWellness(
  userId: string
): Promise<{ remapped: number; earliestDate: string | null }> {
  const rows = await db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, userId),
    columns: { date: true, raw: true },
    orderBy: asc(schema.wellnessDaily.date),
  });

  let remapped = 0;
  let earliestDate: string | null = null;

  for (const row of rows) {
    const raw = row.raw as Record<string, unknown> | null;
    // intervals.icu wellness rows carry the date as `id`. That equality is the
    // discriminator: another provider may have written this row's `raw` last,
    // and parsing an Apple Health payload through the intervals mapping would
    // read fields that mean something else.
    if (!raw || raw.id !== row.date) continue;

    const day = normalizeWellnessRow(raw);
    if (!day) continue;

    const changed = await applyWellnessPatch(
      userId,
      row.date,
      wellnessDayToPatch(day),
      "intervals_icu",
      raw
    );
    if (changed) {
      remapped++;
      earliestDate ??= row.date;
    }
  }

  return { remapped, earliestDate };
}

/**
 * Per-field wellness conflict policy (v0.11 Wearable Connectors).
 *
 * With one provider, whole-row upserts were fine. With two providers
 * reporting the same morning, last-writer-wins is silent data loss: an
 * intervals.icu sync at 05:10 would null out the staged sleep Whoop wrote
 * at 05:05. Every provider wellness write now goes through this merge:
 * a patch field lands iff it is non-null AND its source outranks (or
 * equals) whoever owns the field today. Ownership is recorded per field
 * in wellness_daily.field_sources.
 */
import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type WellnessSource =
  | "manual"
  | "whoop"
  | "oura"
  | "withings"
  | "intervals_icu"
  | "apple_health"
  | "strava";

/** The nullable-field subset a provider can report for one date. */
export interface WellnessPatch {
  hrvMs?: number | null;
  restingHr?: number | null;
  sleepSecs?: number | null;
  sleepScore?: number | null;
  sleepDeepSecs?: number | null;
  sleepRemSecs?: number | null;
  sleepLightSecs?: number | null;
  sleepAwakeSecs?: number | null;
  bedStart?: Date | null;
  bedEnd?: Date | null;
  tempDeviationC?: number | null;
  respiratoryRate?: number | null;
  weightKg?: number | null;
  bodyFatPct?: number | null;
  systolic?: number | null;
  diastolic?: number | null;
  ctl?: number | null;
  atl?: number | null;
  eftp?: number | null;
  vo2max?: number | null;
  rampRate?: number | null;
  pMax?: number | null;
  wPrime?: number | null;
}

export type WellnessField = keyof WellnessPatch;

// Explicit per-field source priority, best first. A field absent here can
// never be written by this merge. Manual entry always wins — the athlete
// typed it on purpose.
const PHYSIOLOGY: WellnessSource[] = [
  "manual",
  "whoop",
  "oura",
  "intervals_icu",
  "apple_health",
];
const BODY: WellnessSource[] = [
  "manual",
  "withings",
  "oura",
  "whoop",
  "intervals_icu",
  "apple_health",
];
// Training-load numbers exist only in intervals.icu's model — a wearable
// or manual "ctl" would be fabrication.
const LOAD: WellnessSource[] = ["intervals_icu"];

export const FIELD_PRIORITY: Record<WellnessField, WellnessSource[]> = {
  hrvMs: PHYSIOLOGY,
  restingHr: PHYSIOLOGY,
  sleepSecs: PHYSIOLOGY,
  sleepScore: PHYSIOLOGY,
  sleepDeepSecs: PHYSIOLOGY,
  sleepRemSecs: PHYSIOLOGY,
  sleepLightSecs: PHYSIOLOGY,
  sleepAwakeSecs: PHYSIOLOGY,
  bedStart: PHYSIOLOGY,
  bedEnd: PHYSIOLOGY,
  tempDeviationC: PHYSIOLOGY,
  respiratoryRate: PHYSIOLOGY,
  vo2max: PHYSIOLOGY,
  weightKg: BODY,
  bodyFatPct: BODY,
  systolic: BODY,
  diastolic: BODY,
  ctl: LOAD,
  atl: LOAD,
  eftp: LOAD,
  rampRate: LOAD,
  pMax: LOAD,
  wPrime: LOAD,
};

/** Lower = better. Infinity = source may never write this field. */
function rank(field: WellnessField, source: WellnessSource): number {
  const i = FIELD_PRIORITY[field].indexOf(source);
  return i === -1 ? Infinity : i;
}

export interface MergeResult {
  /** Field values that actually changed (subset of the patch). */
  changed: Partial<WellnessPatch>;
  /** Updated per-field ownership map (complete, not a delta). */
  fieldSources: Record<string, string>;
}

/**
 * Pure merge. `current` is the existing row's values (undefined field =
 * treated as null), `currentSources` its field_sources (null on legacy
 * rows: every populated field then belongs to `rowSource`).
 *
 * Rules, per non-null patch field:
 * - empty field → write;
 * - owned field → write iff rank(incoming) <= rank(owner) (same-source
 *   re-sync always heals; a better source takes over; ties refresh);
 * - null patch fields never erase existing data.
 */
export function mergeWellnessPatch(
  current: Partial<WellnessPatch>,
  currentSources: Record<string, string> | null,
  rowSource: WellnessSource,
  patch: WellnessPatch,
  source: WellnessSource
): MergeResult {
  const fieldSources: Record<string, string> = {};
  // Seed ownership: explicit map, else legacy attribution to the row source.
  for (const field of Object.keys(FIELD_PRIORITY) as WellnessField[]) {
    const existingValue = current[field];
    const recorded = currentSources?.[field];
    if (recorded != null) fieldSources[field] = recorded;
    else if (existingValue != null) fieldSources[field] = rowSource;
  }

  const changed: Partial<WellnessPatch> = {};
  for (const [key, value] of Object.entries(patch)) {
    const field = key as WellnessField;
    if (value == null) continue;
    if (!(field in FIELD_PRIORITY)) continue;
    if (rank(field, source) === Infinity) continue;

    const owner = fieldSources[field] as WellnessSource | undefined;
    if (owner == null || rank(field, source) <= rank(field, owner)) {
      (changed as Record<string, unknown>)[field] = value;
      fieldSources[field] = source;
    }
  }

  return { changed, fieldSources };
}

/**
 * Upsert one provider's wellness patch for one user-date through the merge.
 * Returns true when anything changed. Callers run computeDailyMetrics
 * themselves (batched over the synced window, not per day).
 */
export async function applyWellnessPatch(
  userId: string,
  date: string,
  patch: WellnessPatch,
  source: WellnessSource,
  raw?: unknown
): Promise<boolean> {
  const existing = await db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      eq(schema.wellnessDaily.date, date)
    ),
  });

  if (!existing) {
    const { changed, fieldSources } = mergeWellnessPatch(
      {},
      null,
      source,
      patch,
      source
    );
    if (Object.keys(changed).length === 0) return false;
    await db.insert(schema.wellnessDaily).values({
      userId,
      date,
      ...changed,
      source,
      fieldSources,
      raw: raw ?? null,
      updatedAt: new Date(),
    });
    return true;
  }

  const { changed } = mergeWellnessPatch(
    existing,
    existing.fieldSources ?? null,
    existing.source as WellnessSource,
    patch,
    source
  );
  if (Object.keys(changed).length === 0) return false;
  // Ownership is written as a jsonb union of ONLY the fields this patch
  // changed, not the full recomputed map: two concurrent writers (a
  // scheduler sync and the Apple Health webhook) would otherwise each
  // overwrite the whole column from a stale read and erase the other's
  // ownership records. Legacy attribution (fields with no recorded owner)
  // is re-derived from the row source on every read, so it never needs to
  // be persisted.
  const ownDelta = Object.fromEntries(
    Object.keys(changed).map((field) => [field, source])
  );
  await db
    .update(schema.wellnessDaily)
    .set({
      ...changed,
      fieldSources: sql`coalesce(${schema.wellnessDaily.fieldSources}, '{}'::jsonb) || ${JSON.stringify(ownDelta)}::jsonb`,
      // raw stays the creating provider's payload unless we own the row.
      ...(existing.source === source && raw !== undefined ? { raw } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.wellnessDaily.id, existing.id));
  return true;
}

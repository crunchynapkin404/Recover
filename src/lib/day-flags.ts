/**
 * Day flags — an athlete states a *fact* about their day; the engine decides
 * what it means for the math. Flagged days are excluded from rolling baselines
 * so a week of flu can't drag the 60-day reference down for the next two
 * months. Flagged days are still scored — exclusion governs baseline
 * membership only.
 *
 * Distinct from behavior tags (☕ caffeine, 🍷 alcohol): a tag is a choice you
 * want measured, a flag is a fact that invalidates the measurement.
 *
 * Zero imports by design: `db/schema.ts` needs `DayFlag` and `metrics.ts`
 * imports `db/schema`, so defining this type in either would cycle.
 */

export type DayFlag = "ill" | "travel" | "altitude";

export const ALL_DAY_FLAGS: ReadonlyArray<{
  key: DayFlag;
  emoji: string;
  label: string;
}> = [
  { key: "ill", emoji: "🤒", label: "Ill" },
  { key: "travel", emoji: "✈️", label: "Travel" },
  { key: "altitude", emoji: "🏔️", label: "Altitude" },
];

const KNOWN_FLAGS: ReadonlySet<string> = new Set(
  ALL_DAY_FLAGS.map((f) => f.key)
);

/**
 * Keep only known flags, de-duplicated. Flags arrive from a browser and land
 * in JSONB, so a client must not be able to write arbitrary JSON into the
 * column; unknown values already stored are dropped at read time rather than
 * throwing.
 */
export function sanitizeDayFlags(input: unknown): DayFlag[] {
  if (!Array.isArray(input)) return [];
  const out: DayFlag[] = [];
  for (const value of input) {
    if (
      typeof value === "string" &&
      KNOWN_FLAGS.has(value) &&
      !out.includes(value as DayFlag)
    ) {
      out.push(value as DayFlag);
    }
  }
  return out;
}

/**
 * Every day flag excludes the day from baselines — there is no per-flag rule.
 * A flag *is* the statement "this day doesn't represent my normal physiology";
 * keeping the rule total is what makes it explainable.
 */
export function isBaselineExcluded(
  flags: DayFlag[] | null | undefined
): boolean {
  return sanitizeDayFlags(flags).length > 0;
}

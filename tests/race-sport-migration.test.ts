import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inferPlanSport, RACE_TYPE_SPORT } from "@/lib/plan-sport";

/**
 * The migration backfills in SQL; `inferPlanSport` decides in TypeScript
 * from `RACE_TYPE_SPORT`. Two implementations of one rule drift, and
 * v0.27.0 already paid for that once.
 *
 * A prior version of this file compared the SQL against a *hand-copied
 * mirror* of `RACE_TYPE_SPORT` that lived only here, in the test — which
 * could (and did) drift from the real table while every assertion kept
 * passing, because the test was only proving the mirror agreed with
 * itself. This version reads `RACE_TYPE_SPORT` directly and extracts the
 * SQL's own `WHEN … THEN …` pairs, so there is exactly one source of truth
 * on each side and the two cannot silently disagree. No database needed:
 * it reads the SQL file and the module.
 */
const SQL = readFileSync("drizzle/0038_race_sport.sql", "utf8");

/** Every `WHEN 'key' THEN 'value'` pair the migration's CASE actually has. */
function sqlCaseEntries(sql: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const re = /WHEN\s+'([^']+)'\s+THEN\s+'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) {
    entries[m[1]] = m[2];
  }
  return entries;
}

describe("0038_race_sport", () => {
  it("has a journal entry, or drizzle-kit silently skips it", () => {
    const journal = JSON.parse(
      readFileSync("drizzle/meta/_journal.json", "utf8")
    ) as { entries: { tag: string }[] };
    expect(journal.entries.map((e) => e.tag)).toContain("0038_race_sport");
  });

  it("backfills before it constrains", () => {
    const update = SQL.indexOf("UPDATE");
    const notNull = SQL.indexOf("SET NOT NULL");
    expect(update).toBeGreaterThan(-1);
    expect(notNull).toBeGreaterThan(update);
  });

  it("declares no default — a default is a silent decision", () => {
    expect(SQL).not.toMatch(/SET\s+DEFAULT/i);
  });

  it("the SQL's CASE has exactly the same keys and values as RACE_TYPE_SPORT — drift in either direction fails this", () => {
    // Not a subset check: a key the SQL has but RACE_TYPE_SPORT does not
    // (or vice versa) is exactly the F3 defect, so this must catch both
    // directions, not just "every TS key is present in the SQL".
    expect(sqlCaseEntries(SQL)).toEqual(RACE_TYPE_SPORT);
  });

  it("agrees with inferPlanSport on every canonical key plus real-world separator spellings", () => {
    const sqlEntries = sqlCaseEntries(SQL);
    const spellingVariants = [
      "GranFondo",
      "gran fondo",
      "gran_fondo",
      "Half Marathon",
      "half_marathon",
    ];
    for (const raceType of [
      ...Object.keys(RACE_TYPE_SPORT),
      ...spellingVariants,
    ]) {
      const normalisedKey = raceType.toLowerCase().replace(/[^a-z0-9.]/g, "");
      expect(sqlEntries[normalisedKey] ?? null).toBe(inferPlanSport(raceType));
    }
  });

  it("uses an exact lookup, never a LIKE", () => {
    // The whole point: three heuristic attempts each produced a confidently
    // wrong sport. A LIKE reappearing here would reintroduce that class.
    expect(SQL).not.toMatch(/\bLIKE\b/i);
    expect(SQL).toContain("regexp_replace");
  });

  it("refuses a race type nobody enumerated", () => {
    for (const unknown of [
      "time trial",
      "10k open water swim",
      "general_fitness",
      "swimrun",
    ]) {
      const key = unknown.toLowerCase().replace(/[^a-z0-9.]/g, "");
      expect(sqlCaseEntries(SQL)[key]).toBeUndefined();
      expect(inferPlanSport(unknown)).toBeNull();
    }
  });
});

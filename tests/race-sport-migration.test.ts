import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inferPlanSport, type PlanSport } from "@/lib/plan-sport";

/**
 * The migration backfills in SQL; `inferPlanSport` decides in TypeScript.
 * Two implementations of one rule drift, and v0.27.0 already paid for that
 * once — so this asserts they agree on every race type the app can produce.
 * No database needed: it reads the SQL and the function.
 */
const SQL = readFileSync("drizzle/0038_race_sport.sql", "utf8");

const RACE_TYPES = [
  "marathon",
  "half_marathon",
  "10k",
  "5k",
  "ultra",
  "ironman",
  "70.3",
  "olympic_tri",
  "sprint_tri",
  "gran_fondo",
  "century",
  "crit",
  "GranFondo",
  "gran fondo",
  "Half Marathon",
];

/**
 * Mirrors the CASE in the migration: normalise, then look up exactly.
 * Never substring matching — three attempts at heuristics each produced a
 * confidently wrong sport, and this is the SQL half of the same rule.
 */
function sqlWouldAssign(raceType: string): PlanSport | null {
  const key = raceType.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const TABLE: Record<string, PlanSport> = {
    marathon: "Run",
    halfmarathon: "Run",
    "10k": "Run",
    "5k": "Run",
    ultra: "Run",
    ultramarathon: "Run",
    parkrun: "Run",
    ironman: "Triathlon",
    "70.3": "Triathlon",
    olympictri: "Triathlon",
    sprinttri: "Triathlon",
    halfironman: "Triathlon",
    triathlon: "Triathlon",
    granfondo: "Bike",
    century: "Bike",
    crit: "Bike",
    criterium: "Bike",
  };
  return TABLE[key] ?? null;
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

  it("assigns what inferPlanSport assigns, for every race type", () => {
    for (const raceType of RACE_TYPES) {
      expect(sqlWouldAssign(raceType)).toBe(inferPlanSport(raceType));
    }
  });

  it("mirrors every key the SQL actually contains", () => {
    // Guards the mirror itself: a key added to the SQL but not to
    // sqlWouldAssign would make the agreement test vacuous.
    for (const key of [
      "marathon",
      "halfmarathon",
      "10k",
      "5k",
      "ultra",
      "ultramarathon",
      "parkrun",
      "ironman",
      "70.3",
      "olympictri",
      "sprinttri",
      "halfironman",
      "triathlon",
      "granfondo",
      "century",
      "crit",
      "criterium",
    ]) {
      expect(SQL).toContain(`'${key}'`);
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
      expect(sqlWouldAssign(unknown)).toBeNull();
      expect(inferPlanSport(unknown)).toBeNull();
    }
  });
});

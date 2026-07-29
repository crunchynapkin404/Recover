import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("migration 0033", () => {
  it("adds the event demand columns to races", async () => {
    const r = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'races'`
    );
    const cols = r.rows.map((x) => x.column_name);
    expect(cols).toContain("event_days");
    expect(cols).toContain("distance_km");
    expect(cols).toContain("elevation_m");
    expect(cols).toContain("demand_hours_override");
  });

  it("defaults event_days to 1 so existing races stay valid", async () => {
    const r = await db.execute(
      sql`select column_default from information_schema.columns
          where table_name = 'races' and column_name = 'event_days'`
    );
    expect(String(r.rows[0].column_default)).toContain("1");
  });

  it("creates race_stages with a unique day per race", async () => {
    const r = await db.execute(
      sql`select indexname from pg_indexes where tablename = 'race_stages'`
    );
    expect(r.rows.map((x) => x.indexname)).toContain("race_stages_race_day_uq");
  });
});

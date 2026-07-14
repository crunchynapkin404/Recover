import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

// Integration test for the ported dual-driver db proxy (Principle 1).
// Requires a running Postgres and env: DATABASE_URL + DATABASE_DRIVER=pg.
// Locally: `set -a; . ./.env; set +a; npm test`. Skips when unset (e.g. CI without a db service).
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("db dual-driver proxy (pg path)", () => {
  it("lazily connects and executes a query", async () => {
    const { db } = await import("@/lib/db");
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows[0].one).toBe(1);
  });

  it("exposes the drizzle schema query API", async () => {
    const { db } = await import("@/lib/db");
    const users = await db.query.users.findMany({ limit: 1 });
    expect(Array.isArray(users)).toBe(true);
  });
});

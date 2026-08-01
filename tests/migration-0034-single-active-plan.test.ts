import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-migration-0034-user";

// The migration's UPDATE, scoped to one test user. The production migration
// is unscoped by design; running THAT here would rewrite real accounts.
const ARCHIVE_DUPES = sql`
  UPDATE training_plans p
  SET status = 'archived'
  WHERE p.status = 'active'
    AND p.user_id = ${USER}
    AND EXISTS (
      SELECT 1 FROM training_plans q
      WHERE q.user_id = p.user_id
        AND q.status = 'active'
        AND (q.created_at, q.id) > (p.created_at, p.id)
    )
`;

async function seed(createdAt: string, currentWeek: number) {
  const [row] = await db
    .insert(schema.trainingPlans)
    .values({
      userId: USER,
      title: "century training plan",
      raceType: "century",
      raceDate: "2026-09-13",
      startDate: "2026-07-15",
      weeksTotal: 9,
      currentWeek,
      status: "active",
      constraints: { daysPerWeek: 4, hoursPerWeek: 10, sports: ["Bike"] },
      createdAt: new Date(createdAt),
    })
    .returning();
  return row;
}

describe.skipIf(!hasDb)("migration 0034 — single active plan", () => {
  let newestId: string;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({ id: USER, name: USER, email: `${USER}@example.invalid` })
      .onConflictDoNothing();
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));

    await seed("2026-07-15T12:14:00Z", 1);
    await seed("2026-07-15T12:17:00Z", 1);
    newestId = (await seed("2026-07-15T12:46:00Z", 4)).id;
  });

  afterAll(async () => {
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, USER));
  });

  it("leaves exactly one active plan, the newest", async () => {
    await db.execute(ARCHIVE_DUPES);

    const rows = await db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, USER),
    });
    const active = rows.filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(newestId);
    expect(active[0].currentWeek).toBe(4);
    expect(rows.filter((r) => r.status === "archived")).toHaveLength(2);
  });

  it("is idempotent — a second run changes nothing", async () => {
    await db.execute(ARCHIVE_DUPES);

    const rows = await db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, USER),
    });
    const active = rows.filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(newestId);
  });
});

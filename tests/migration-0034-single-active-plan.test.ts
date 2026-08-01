import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-migration-0034-user";
const TIE_USER = "test-migration-0034-tie-user";

// The migration's UPDATE, scoped to a single test user. The production
// migration is unscoped by design; running THAT here would rewrite real
// accounts. Parameterised so both fixture users can reuse the same query
// shape without an unscoped fallback.
function archiveDupesFor(user: string) {
  return sql`
    UPDATE training_plans p
    SET status = 'archived'
    WHERE p.status = 'active'
      AND p.user_id = ${user}
      AND EXISTS (
        SELECT 1 FROM training_plans q
        WHERE q.user_id = p.user_id
          AND q.status = 'active'
          AND (q.created_at, q.id) > (p.created_at, p.id)
      )
  `;
}

async function seed(
  createdAt: string,
  currentWeek: number,
  userId: string = USER
) {
  const [row] = await db
    .insert(schema.trainingPlans)
    .values({
      userId,
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
    const result = await db.execute(archiveDupesFor(USER));
    expect(result.rowCount).toBe(2);

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
    const result = await db.execute(archiveDupesFor(USER));
    expect(result.rowCount).toBe(0);

    const rows = await db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, USER),
    });
    const active = rows.filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(newestId);
  });
});

describe.skipIf(!hasDb)("migration 0034 — (created_at, id) tie-break", () => {
  let lowerId: string;
  let higherId: string;

  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: TIE_USER,
        name: TIE_USER,
        email: `${TIE_USER}@example.invalid`,
      })
      .onConflictDoNothing();
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, TIE_USER));

    // Same created_at on both rows — this is what a plan-creation retry
    // inside a single transaction produces, since now() is constant within
    // a transaction. With created_at tied, only the id half of the
    // (created_at, id) tuple can decide which plan survives.
    const tiedCreatedAt = "2026-07-15T12:14:00Z";
    const a = await seed(tiedCreatedAt, 1, TIE_USER);
    const b = await seed(tiedCreatedAt, 1, TIE_USER);
    [lowerId, higherId] = [a.id, b.id].sort();
  });

  afterAll(async () => {
    await db
      .delete(schema.trainingPlans)
      .where(eq(schema.trainingPlans.userId, TIE_USER));
  });

  it("keeps the row with the greater id when created_at ties", async () => {
    const result = await db.execute(archiveDupesFor(TIE_USER));
    expect(result.rowCount).toBe(1);

    const rows = await db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, TIE_USER),
    });
    const active = rows.filter((r) => r.status === "active");
    expect(active).toHaveLength(1);
    // higherId/lowerId were derived from [a.id, b.id].sort() in beforeAll,
    // i.e. higherId > lowerId by construction (matching (q.id) > (p.id)).
    expect(active[0].id).toBe(higherId);

    const archived = rows.filter((r) => r.status === "archived");
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe(lowerId);
  });
});

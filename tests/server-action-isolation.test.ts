import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * Task 8 (isolation audit) — representative server-action test (brief Step
 * 3: "one representative server action" proving cross-user denial; the
 * dozen structurally-identical `requireUser()` + `.where(eq(x.userId,
 * user.id))` actions don't each need their own copy).
 *
 * removeRace (src/app/plan/actions.ts) is chosen because it's a delete by
 * client-supplied id — the shape most likely to leak if a future refactor
 * ever dropped the userId half of the WHERE clause in
 * src/lib/race/service.ts's deleteRace. It's "use server" + requireUser(),
 * so @/lib/session and next/cache are mocked the same way
 * tests/plan-actions-race.test.ts does (framework plumbing that throws
 * outside a real request, not the logic under test) — everything else
 * (deleteRace, the Drizzle delete) is real, against real Postgres.
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const OWNER = "test-action-isolation-owner";
const ATTACKER = "test-action-isolation-attacker";

let currentUserId = OWNER;

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: currentUserId, name: currentUserId }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  for (const id of [OWNER, ATTACKER]) {
    await db.delete(schema.races).where(eq(schema.races.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

describe.skipIf(!hasDb)("removeRace server action — cross-user denial", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    for (const id of [OWNER, ATTACKER]) {
      await db
        .insert(schema.users)
        .values({ id, name: id, email: `${id}@example.invalid` });
    }
  });

  afterAll(cleanup);

  it("a race owned by user A survives a delete attempt made under user B's session", async () => {
    const { db, schema } = await import("@/lib/db");
    const [race] = await db
      .insert(schema.races)
      .values({
        userId: OWNER,
        name: "Owner's Goal Marathon",
        raceType: "marathon",
        date: ymd(60),
        priority: "A",
      })
      .returning();

    // Attacker's session calls the real server action with the victim's
    // race id — a guessed/observed uuid, e.g. leaked in a shared link.
    currentUserId = ATTACKER;
    const { removeRace } = await import("@/app/plan/actions");
    await removeRace(race.id);

    const stillThere = await db.query.races.findFirst({
      where: eq(schema.races.id, race.id),
    });
    expect(stillThere).toBeDefined();
    expect(stillThere?.userId).toBe(OWNER);

    // Sanity: the owner's own session can delete it (proves removeRace
    // isn't simply broken/no-op — the earlier survival was ownership-gated).
    currentUserId = OWNER;
    await removeRace(race.id);
    const gone = await db.query.races.findFirst({
      where: eq(schema.races.id, race.id),
    });
    expect(gone).toBeUndefined();
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * v0.9.0 Task 3 review finding: setBodyPrefs was previously "verified" by
 * reimplementing its drizzle statements in a throwaway script, and the
 * validation matrix was a standalone copy of the regex/range checks — the
 * actually-shipped setBodyPrefs had never been executed by anything.
 *
 * The one guarantee this release rests on is that a wake time the athlete
 * never gave is never stored or shown (see schema.ts: bodyPrefs.wakeTime has
 * deliberately no default — "a guessed wake time would put an invented
 * bedtime on the dashboard"). These tests call the real exported
 * setBodyPrefs and read the row back from Postgres, so a future refactor
 * that coerces "" to "00:00" (or otherwise stops treating empty as "clear")
 * fails here instead of silently reappearing on the dashboard.
 *
 * setBodyPrefs is "use server" and calls requireUser(), which reads
 * next/headers()/redirect() — neither works outside a real request. That
 * auth check is a genuine module boundary, not the logic under test (same
 * principle tests/journal-form.test.tsx uses when it stubs a "use server"
 * module), so @/lib/session is mocked here. Everything else — db, schema,
 * the HHMM regex, the sleep-range check, onConflictDoUpdate — is the real
 * code.
 *
 * next/cache's revalidatePath also throws ("Invariant: static generation
 * store missing") outside a request context, discovered while building this
 * test: calling the real function with only @/lib/session mocked wrote the
 * row correctly and then threw on revalidatePath, which would have made a
 * naive test read this as total rejection despite the write having
 * succeeded. revalidatePath is likewise framework plumbing, not logic this
 * suite is responsible for, so it's stubbed too.
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-body-prefs-user";

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: USER })),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.bodyPrefs).where(eq(schema.bodyPrefs.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

async function row() {
  const { db, schema } = await import("@/lib/db");
  return db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, USER),
  });
}

describe.skipIf(!hasDb)("setBodyPrefs — honest wake time", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "BodyPrefsTest",
        email: "body-prefs-test@example.invalid",
        role: "member",
      })
      .onConflictDoNothing();
  });

  afterAll(cleanup);

  it("round-trips a valid wake time", async () => {
    const { setBodyPrefs } = await import("@/app/settings/body-actions");

    const result = await setBodyPrefs({
      wakeTime: "07:00",
      sleepNeedSecs: 28800,
    });

    expect(result.ok).toBe(true);
    const saved = await row();
    expect(saved?.wakeTime).toBe("07:00");
    expect(saved?.sleepNeedSecs).toBe(28800);
  });

  it("stores an empty wake time as SQL NULL, not '' or '00:00'", async () => {
    const { setBodyPrefs } = await import("@/app/settings/body-actions");

    const result = await setBodyPrefs({
      wakeTime: "",
      sleepNeedSecs: 28800,
    });

    expect(result.ok).toBe(true);
    const saved = await row();
    // Deliberately not `.toBeFalsy()` — "" would pass that and is exactly
    // the bug this release exists to prevent.
    expect(saved?.wakeTime).toBeNull();
  });

  it("returns an already-set wake time to NULL when cleared", async () => {
    const { setBodyPrefs } = await import("@/app/settings/body-actions");

    const set = await setBodyPrefs({
      wakeTime: "07:00",
      sleepNeedSecs: 28800,
    });
    expect(set.ok).toBe(true);
    expect((await row())?.wakeTime).toBe("07:00");

    const cleared = await setBodyPrefs({
      wakeTime: "",
      sleepNeedSecs: 28800,
    });
    expect(cleared.ok).toBe(true);
    expect((await row())?.wakeTime).toBeNull();
  });

  it("updates the same row on repeated saves instead of duplicating", async () => {
    const { db, schema } = await import("@/lib/db");
    const { setBodyPrefs } = await import("@/app/settings/body-actions");

    await setBodyPrefs({ wakeTime: "07:00", sleepNeedSecs: 28800 });
    await setBodyPrefs({ wakeTime: "06:30", sleepNeedSecs: 25200 });

    const rows = await db.query.bodyPrefs.findMany({
      where: eq(schema.bodyPrefs.userId, USER),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].wakeTime).toBe("06:30");
    expect(rows[0].sleepNeedSecs).toBe(25200);
  });

  it("rejects a malformed wake time and does not write", async () => {
    const { setBodyPrefs } = await import("@/app/settings/body-actions");

    await setBodyPrefs({ wakeTime: "07:00", sleepNeedSecs: 28800 });
    const result = await setBodyPrefs({
      wakeTime: "07:60", // invalid minute
      sleepNeedSecs: 28800,
    });

    expect(result.ok).toBe(false);
    expect((await row())?.wakeTime).toBe("07:00"); // unchanged
  });

  it("rejects an out-of-range sleep target and does not write", async () => {
    const { setBodyPrefs } = await import("@/app/settings/body-actions");

    await setBodyPrefs({ wakeTime: "07:00", sleepNeedSecs: 28800 });
    const result = await setBodyPrefs({
      wakeTime: "07:00",
      sleepNeedSecs: 3600, // below MIN_NEED_SECS (4h)
    });

    expect(result.ok).toBe(false);
    expect((await row())?.sleepNeedSecs).toBe(28800); // unchanged
  });
});

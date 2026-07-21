import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * Task 8 (isolation audit) — GET /api/export is a full personal-data dump
 * (wellness_daily, activities, daily_metrics, chat_threads). It's session
 * gated, but session gating alone doesn't prove per-row scoping — this test
 * drives the real route handler end-to-end against Postgres and asserts the
 * export for one user never contains a byte of another user's data, even
 * when both have rows in every table the route reads.
 *
 * The route calls `auth.api.getSession({ headers: await headers() })`
 * directly (not via the requireUser() wrapper other surfaces use), so both
 * @/lib/auth and next/headers are mocked here — framework/session-provider
 * plumbing that doesn't run outside a real request, same principle as
 * tests/body-prefs.test.ts stubbing @/lib/session. Everything downstream
 * (the four Drizzle queries, JSON assembly) is the real route code.
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER_A = "test-export-user-a";
const USER_B = "test-export-user-b";

let sessionUserId: string | null = USER_A;

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        sessionUserId == null
          ? null
          : {
              user: {
                id: sessionUserId,
                email: `${sessionUserId}@example.invalid`,
                name: sessionUserId,
              },
            },
    },
  },
}));

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  for (const id of [USER_A, USER_B]) {
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, id));
    await db.delete(schema.activities).where(eq(schema.activities.userId, id));
    await db
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, id));
    await db
      .delete(schema.chatThreads)
      .where(eq(schema.chatThreads.userId, id));
    await db.delete(schema.users).where(eq(schema.users.id, id));
  }
}

describe.skipIf(!hasDb)("GET /api/export user scoping", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    for (const id of [USER_A, USER_B]) {
      await db.insert(schema.users).values({
        id,
        name: id,
        email: `${id}@example.invalid`,
      });
    }
    // Distinguishing values per user, per table the route reads.
    await db.insert(schema.wellnessDaily).values([
      { userId: USER_A, date: "2026-07-01", hrvMs: 61 },
      { userId: USER_B, date: "2026-07-01", hrvMs: 999 },
    ]);
    await db.insert(schema.activities).values([
      {
        userId: USER_A,
        provider: "manual",
        externalId: "a-own",
        startDate: new Date("2026-07-01"),
        sport: "Ride",
        name: "A's private ride",
      },
      {
        userId: USER_B,
        provider: "manual",
        externalId: "b-secret",
        startDate: new Date("2026-07-01"),
        sport: "Ride",
        name: "B's secret ride",
      },
    ]);
    await db.insert(schema.dailyMetrics).values([
      { userId: USER_A, date: "2026-07-01", readiness: 55 },
      { userId: USER_B, date: "2026-07-01", readiness: 999 },
    ]);
    await db.insert(schema.chatThreads).values([
      { userId: USER_A, title: "A's thread" },
      { userId: USER_B, title: "B's confidential thread" },
    ]);
  });

  afterAll(cleanup);

  it("only returns the authenticated user's rows across every table", async () => {
    sessionUserId = USER_A;
    const { GET } = await import("@/app/api/export/route");
    const res = await GET();
    const body = (await res.json()) as {
      wellness_daily: Array<{ userId: string; hrvMs: number | null }>;
      activities: Array<{ userId: string; name: string | null }>;
      daily_metrics: Array<{ userId: string; readiness: number | null }>;
      chat_threads: Array<{ userId: string; title: string | null }>;
      user: { email: string };
    };

    expect(body.user.email).toBe(`${USER_A}@example.invalid`);

    expect(body.wellness_daily).toHaveLength(1);
    expect(body.wellness_daily.every((r) => r.userId === USER_A)).toBe(true);
    expect(body.wellness_daily.some((r) => r.hrvMs === 999)).toBe(false);

    expect(body.activities).toHaveLength(1);
    expect(body.activities.every((r) => r.userId === USER_A)).toBe(true);
    expect(body.activities.some((r) => r.name === "B's secret ride")).toBe(
      false
    );

    expect(body.daily_metrics).toHaveLength(1);
    expect(body.daily_metrics.every((r) => r.userId === USER_A)).toBe(true);
    expect(body.daily_metrics.some((r) => r.readiness === 999)).toBe(false);

    expect(body.chat_threads).toHaveLength(1);
    expect(body.chat_threads.every((r) => r.userId === USER_A)).toBe(true);
    expect(
      body.chat_threads.some((r) => r.title === "B's confidential thread")
    ).toBe(false);

    // The whole serialized body, belt-and-suspenders: B's distinguishing
    // strings/numbers must not appear anywhere in A's export.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("B's secret ride");
    expect(raw).not.toContain("B's confidential thread");
  });

  it("returns B's own data for B's session, symmetrically", async () => {
    sessionUserId = USER_B;
    const { GET } = await import("@/app/api/export/route");
    const res = await GET();
    const body = (await res.json()) as {
      activities: Array<{ userId: string; name: string | null }>;
    };
    expect(body.activities).toHaveLength(1);
    expect(body.activities[0].name).toBe("B's secret ride");
  });

  it("401s with no session", async () => {
    sessionUserId = null;
    try {
      const { GET } = await import("@/app/api/export/route");
      const res = await GET();
      expect(res.status).toBe(401);
    } finally {
      sessionUserId = USER_A;
    }
  });
});

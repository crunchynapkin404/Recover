import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { seedActivityStreams } from "../scripts/seed-demo";

/** DB suite; skips without Postgres (see [[recover-db-test-ci-guard]]). */
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-seed-activity-streams-user";
const NEWEST_EXTERNAL_ID = "seed-activity-streams-test-newest";
const OLDER_EXTERNAL_ID = "seed-activity-streams-test-older";

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("seedActivityStreams", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await cleanup();
    await db.insert(schema.users).values({
      id: USER,
      name: "SeedActivityStreamsTest",
      email: `${USER}@example.invalid`,
      role: "member",
    });

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    // Two activities is the minimum seedActivityStreams needs to have a
    // choice to make at all: newest gets the streams (resolveActivityDetailPath
    // opens the newest link on /train?tab=history), and debriefState=pending
    // must go on a DIFFERENT activity — see seedActivityStreams' own comment
    // on why (ActivityDebriefSection renders inline, over the same vertical
    // band the stream charts occupy).
    await db.insert(schema.activities).values([
      {
        userId: USER,
        provider: "manual",
        externalId: NEWEST_EXTERNAL_ID,
        startDate: new Date(now),
        sport: "Ride",
        name: "Newest ride",
      },
      {
        userId: USER,
        provider: "manual",
        externalId: OLDER_EXTERNAL_ID,
        startDate: new Date(now - DAY_MS),
        sport: "Ride",
        name: "Older ride",
      },
    ]);

    await seedActivityStreams(USER, Math.random);
  });

  afterAll(cleanup);

  it("never lands debriefState=pending on the activity that carries streams", async () => {
    const { db, schema } = await import("@/lib/db");

    const activities = await db.query.activities.findMany({
      where: eq(schema.activities.userId, USER),
    });
    const activityIds = activities.map((a) => a.id);

    const streamRows = await db.query.activityStreams.findMany({
      where: inArray(schema.activityStreams.activityId, activityIds),
    });
    const activityIdsWithStreams = new Set(streamRows.map((r) => r.activityId));
    const pendingActivities = activities.filter(
      (a) => a.debriefState === "pending"
    );

    // Sanity: both branches of the invariant actually fired for this run —
    // otherwise the assertion below would pass vacuously (nothing seeded,
    // nothing pending) without checking anything.
    expect(activityIdsWithStreams.size).toBeGreaterThan(0);
    expect(pendingActivities.length).toBeGreaterThan(0);

    // The invariant itself: no activity that carries stream rows may also
    // be the one debriefState=pending points at. If a future change made
    // both states land on the same activity, /activity/[id] would render
    // ActivityDebriefSection directly over the stream charts, and nothing
    // else in this codebase — not axe, not the resolver, not any other
    // test — would notice; only a human looking at the screenshot would.
    for (const pending of pendingActivities) {
      expect(activityIdsWithStreams.has(pending.id)).toBe(false);
    }
  });
});

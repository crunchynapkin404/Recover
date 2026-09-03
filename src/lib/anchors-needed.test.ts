import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { missingAnchors } from "./anchors-needed";

// requires Postgres; skips without DATABASE_URL. Same shape as first-run.test.ts.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const RUNNER = "test-anchors-runner";
const CYCLIST = "test-anchors-cyclist";
const ANCHORED = "test-anchors-anchored";
const DISMISSED = "test-anchors-dismissed";
const IDLE = "test-anchors-idle";
const INDOOR_ONLY = "test-anchors-indoor-only";
const ALL_USERS = [RUNNER, CYCLIST, ANCHORED, DISMISSED, IDLE, INDOOR_ONLY];

function activity(userId: string, sport: string, externalId: string) {
  return {
    userId,
    provider: "intervals_icu" as const,
    externalId,
    startDate: new Date(),
    sport,
  };
}

describe.skipIf(!hasDb)("missingAnchors", () => {
  beforeAll(async () => {
    await db.insert(schema.users).values(
      ALL_USERS.map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
      }))
    );
    await db.insert(schema.activities).values([
      activity(RUNNER, "Run", "a-run-1"),
      // THE GUARD. Providers store "Ride"/"VirtualRide"/"GravelRide", never
      // "Bike". A resolver comparing sport directly against the planner's
      // vocabulary matches nothing, and the FTP prompt never fires for
      // anyone who rides — silent, green, invisible unless you ride. That is
      // the exact bug canonical-sport.ts's header records: 219 live rides,
      // not one matched.
      activity(CYCLIST, "VirtualRide", "a-ride-1"),
      activity(ANCHORED, "Run", "a-run-2"),
      activity(ANCHORED, "GravelRide", "a-ride-2"),
      activity(DISMISSED, "Run", "a-run-3"),
      activity(INDOOR_ONLY, "Ride", "a-ride-3"),
    ]);
    await db.insert(schema.bodyPrefs).values([
      { userId: ANCHORED, thresholdPaceSecPerKm: 285, ftpWatts: 250 },
      { userId: DISMISSED, anchorPromptDismissedAt: new Date() },
      { userId: INDOOR_ONLY, ftpWattsIndoor: 220 },
    ]);
  });

  afterAll(async () => {
    for (const id of ALL_USERS) {
      await db
        .delete(schema.activities)
        .where(eq(schema.activities.userId, id));
      await db.delete(schema.bodyPrefs).where(eq(schema.bodyPrefs.userId, id));
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
  });

  it("asks a runner with no pace for a pace, and not for an FTP", async () => {
    expect(await missingAnchors(RUNNER)).toEqual({
      ftp: false,
      pace: true,
      dismissed: false,
    });
  });

  it("asks a cyclist for an FTP even though the provider said VirtualRide", async () => {
    expect(await missingAnchors(CYCLIST)).toEqual({
      ftp: true,
      pace: false,
      dismissed: false,
    });
  });

  it("asks an athlete who does both for nothing once both are set", async () => {
    expect(await missingAnchors(ANCHORED)).toEqual({
      ftp: false,
      pace: false,
      dismissed: false,
    });
  });

  it("reports a dismissal without forgetting what is still missing", async () => {
    expect(await missingAnchors(DISMISSED)).toEqual({
      ftp: false,
      pace: true,
      dismissed: true,
    });
  });

  it("asks an athlete with no activity for nothing at all", async () => {
    expect(await missingAnchors(IDLE)).toEqual({
      ftp: false,
      pace: false,
      dismissed: false,
    });
  });

  // ftpWattsIndoor is a fallback anchor whose schema comment says it "can
  // never mean 'use it for race day' directly" — which is the figure the
  // prompt is about. An indoor number does not answer the outdoor question.
  it("still asks for an outdoor FTP when only the indoor one is set", async () => {
    expect(await missingAnchors(INDOOR_ONLY)).toEqual({
      ftp: true,
      pace: false,
      dismissed: false,
    });
  });
});

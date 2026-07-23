import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  handleStravaWebhookEvent,
  isStravaWebhookEvent,
  verifyChallenge,
  type StravaWebhookEvent,
} from "./strava-webhook";

describe("verifyChallenge", () => {
  const token = "shh-its-a-secret";

  it("echoes the challenge when mode and token match", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": token,
      "hub.challenge": "abc123",
    });
    expect(verifyChallenge(params, token)).toEqual({ challenge: "abc123" });
  });

  it("rejects a mismatched verify_token", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "abc123",
    });
    expect(verifyChallenge(params, token)).toBeNull();
  });

  it("rejects a non-subscribe mode", () => {
    const params = new URLSearchParams({
      "hub.mode": "unsubscribe",
      "hub.verify_token": token,
      "hub.challenge": "abc123",
    });
    expect(verifyChallenge(params, token)).toBeNull();
  });

  it("rejects a missing challenge", () => {
    const params = new URLSearchParams({
      "hub.mode": "subscribe",
      "hub.verify_token": token,
    });
    expect(verifyChallenge(params, token)).toBeNull();
  });
});

describe("isStravaWebhookEvent", () => {
  it("accepts a well-formed activity event", () => {
    expect(
      isStravaWebhookEvent({
        aspect_type: "create",
        object_type: "activity",
        object_id: 1,
        owner_id: 42,
        subscription_id: 1,
        event_time: 1700000000,
      })
    ).toBe(true);
  });

  it("rejects garbage payloads", () => {
    expect(isStravaWebhookEvent(null)).toBe(false);
    expect(isStravaWebhookEvent("nope")).toBe(false);
    expect(isStravaWebhookEvent({})).toBe(false);
    expect(
      isStravaWebhookEvent({ aspect_type: "create", object_type: "activity" })
    ).toBe(false); // owner_id missing
    expect(
      isStravaWebhookEvent({
        aspect_type: "explode",
        object_type: "activity",
        owner_id: 1,
      })
    ).toBe(false);
  });
});

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const OWNER_ID = "9182736450"; // Strava athlete id — arbitrary, test-only
const USER_ID = "test-strava-webhook-user";

function event(overrides: Partial<StravaWebhookEvent> = {}): StravaWebhookEvent {
  return {
    aspect_type: "create",
    object_type: "activity",
    object_id: 123,
    owner_id: Number(OWNER_ID),
    subscription_id: 1,
    event_time: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe.skipIf(!hasDb)("handleStravaWebhookEvent", () => {
  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, USER_ID));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, USER_ID));
    await db.delete(schema.users).where(eq(schema.users.id, USER_ID));
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: USER_ID,
        name: "Strava Webhook Test User",
        email: "strava-webhook-test@example.invalid",
      })
      .onConflictDoNothing();
    await db
      .delete(schema.syncJobs)
      .where(eq(schema.syncJobs.userId, USER_ID));
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, USER_ID));
  });

  it("no-ops for an unknown athlete", async () => {
    const { db, schema } = await import("@/lib/db");
    const result = await handleStravaWebhookEvent(event());
    expect(result.scheduled).toBe(false);

    const jobs = await db.query.syncJobs.findMany({
      where: eq(schema.syncJobs.userId, USER_ID),
    });
    expect(jobs).toHaveLength(0);
  });

  it("no-ops for a delete event", async () => {
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.connections).values({
      userId: USER_ID,
      provider: "strava",
      encryptedAccessToken: "x",
      externalAthleteId: OWNER_ID,
      status: "active",
    });
    await db.insert(schema.connections).values({
      userId: USER_ID,
      provider: "intervals_icu",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
      status: "active",
    });

    const result = await handleStravaWebhookEvent(
      event({ aspect_type: "delete" })
    );
    expect(result.scheduled).toBe(false);

    const jobs = await db.query.syncJobs.findMany({
      where: eq(schema.syncJobs.userId, USER_ID),
    });
    expect(jobs).toHaveLength(0);
  });

  it("schedules a near-term intervals.icu sync for a known athlete", async () => {
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.connections).values({
      userId: USER_ID,
      provider: "strava",
      encryptedAccessToken: "x",
      externalAthleteId: OWNER_ID,
      status: "active",
    });
    await db.insert(schema.connections).values({
      userId: USER_ID,
      provider: "intervals_icu",
      encryptedAccessToken: "x",
      externalAthleteId: "i1",
      status: "active",
    });

    const before = Date.now();
    const result = await handleStravaWebhookEvent(event());
    expect(result.scheduled).toBe(true);

    const job = await db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.userId, USER_ID),
    });
    expect(job?.provider).toBe("intervals_icu");
    expect(job?.status).toBe("pending");
    // Scheduled ~90s out (INTERVALS_CATCHUP_DELAY_S), not immediately.
    expect(job!.runAfter.getTime()).toBeGreaterThan(before + 60_000);
    expect(job!.runAfter.getTime()).toBeLessThan(before + 130_000);
  });

  it("does not schedule intervals sync when the user has no intervals connection", async () => {
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.connections).values({
      userId: USER_ID,
      provider: "strava",
      encryptedAccessToken: "x",
      externalAthleteId: OWNER_ID,
      status: "active",
    });

    const result = await handleStravaWebhookEvent(event());
    expect(result.scheduled).toBe(false);

    const jobs = await db.query.syncJobs.findMany({
      where: eq(schema.syncJobs.userId, USER_ID),
    });
    expect(jobs).toHaveLength(0);
  });
});

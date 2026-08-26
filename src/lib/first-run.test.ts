import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isFirstRun } from "./first-run";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const BARE_USER = "test-first-run-bare-user";
const CONNECTED_USER = "test-first-run-connected-user";
const LOGGED_USER = "test-first-run-logged-user";
const RETURNING_USER = "test-first-run-returning-user";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!hasDb)("isFirstRun", () => {
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values([
        {
          id: BARE_USER,
          name: "Test First Run Bare User",
          email: `${BARE_USER}@example.invalid`,
        },
        {
          id: CONNECTED_USER,
          name: "Test First Run Connected User",
          email: `${CONNECTED_USER}@example.invalid`,
        },
        {
          id: LOGGED_USER,
          name: "Test First Run Logged User",
          email: `${LOGGED_USER}@example.invalid`,
        },
        {
          id: RETURNING_USER,
          name: "Test First Run Returning User",
          email: `${RETURNING_USER}@example.invalid`,
        },
      ])
      .onConflictDoNothing();

    await db.insert(schema.connections).values({
      userId: CONNECTED_USER,
      provider: "strava",
      encryptedAccessToken: "test-encrypted-token",
      externalAthleteId: "test-first-run-external-athlete",
      status: "active",
    });

    await db.insert(schema.wellnessDaily).values({
      userId: LOGGED_USER,
      date: daysAgo(1),
    });

    await db.insert(schema.wellnessDaily).values({
      userId: RETURNING_USER,
      date: daysAgo(200),
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.connections)
      .where(eq(schema.connections.userId, CONNECTED_USER));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, LOGGED_USER));
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, RETURNING_USER));
    await db.delete(schema.users).where(eq(schema.users.id, BARE_USER));
    await db.delete(schema.users).where(eq(schema.users.id, CONNECTED_USER));
    await db.delete(schema.users).where(eq(schema.users.id, LOGGED_USER));
    await db.delete(schema.users).where(eq(schema.users.id, RETURNING_USER));
  });

  it("is true for an owner with no connection and no wellness", async () => {
    expect(await isFirstRun(BARE_USER)).toBe(true);
  });

  it("is false once any connection exists, even with no wellness", async () => {
    expect(await isFirstRun(CONNECTED_USER)).toBe(false);
  });

  it("is false once any wellness row exists, even with no connection", async () => {
    expect(await isFirstRun(LOGGED_USER)).toBe(false);
  });

  it("is false for wellness OLDER than 90 days — 'ever', not 'recently'", async () => {
    // This is the case Today's old inline gate got wrong: it windowed to 90
    // days, so a returning athlete was treated as brand new.
    expect(await isFirstRun(RETURNING_USER)).toBe(false);
  });
});

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { resolveWeek } from "./resolve";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-availability-user";

describe.skipIf(!hasDb)("resolveWeek", () => {
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "Availability Test User",
        email: `${USER}@example.test`,
      })
      .onConflictDoNothing();
    // Standard week: Wednesday (weekday 2) 90 minutes, nothing else.
    await db
      .insert(schema.availabilityDefaults)
      .values({
        userId: USER,
        weekday: 2,
        blocks: [
          {
            start: "18:00",
            end: "19:30",
            mins: 90,
            energy: "normal",
            sports: null,
          },
        ],
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.availabilityOverrides)
      .where(eq(schema.availabilityOverrides.userId, USER));
    await db
      .delete(schema.availabilityDefaults)
      .where(eq(schema.availabilityDefaults.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("returns the weekday default when no override exists", async () => {
    const r = await resolveWeek(USER, ["2026-08-05"]); // a Wednesday
    expect(r.get("2026-08-05")?.[0].mins).toBe(90);
  });

  it("returns an empty day for a weekday with no default", async () => {
    const r = await resolveWeek(USER, ["2026-08-03"]); // Monday
    expect(r.get("2026-08-03")).toEqual([]);
  });

  it("lets a date override beat the default, and survive a default change", async () => {
    await db.insert(schema.availabilityOverrides).values({
      userId: USER,
      date: "2026-08-05",
      blocks: [
        {
          start: "19:00",
          end: "20:00",
          mins: 60,
          energy: "easy",
          sports: null,
        },
      ],
    });
    await db
      .update(schema.availabilityDefaults)
      .set({
        blocks: [
          {
            start: "17:00",
            end: "20:00",
            mins: 180,
            energy: "full",
            sports: null,
          },
        ],
      })
      .where(eq(schema.availabilityDefaults.userId, USER));

    const r = await resolveWeek(USER, ["2026-08-05", "2026-08-12"]);
    expect(r.get("2026-08-05")?.[0].mins).toBe(60); // pinned
    expect(r.get("2026-08-12")?.[0].mins).toBe(180); // follows the new default
  });

  it("treats an empty override as unavailable", async () => {
    await db.insert(schema.availabilityOverrides).values({
      userId: USER,
      date: "2026-08-19",
      blocks: [],
    });
    const r = await resolveWeek(USER, ["2026-08-19"]);
    expect(r.get("2026-08-19")).toEqual([]);
  });
});

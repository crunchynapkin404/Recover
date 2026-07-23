import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-activity-write-user";

describe.skipIf(!hasDb)("deleteActivity", () => {
  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({ id: USER, name: "Delete Test", email: "delete-test@example.invalid" })
      .onConflictDoNothing();
    await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  });

  it("deletes an activity the user owns and returns true", async () => {
    const { db, schema } = await import("@/lib/db");
    const { deleteActivity } = await import("@/lib/activity-write");
    const [row] = await db
      .insert(schema.activities)
      .values({
        userId: USER,
        provider: "manual",
        externalId: "del-1",
        startDate: new Date(),
        sport: "Ride",
      })
      .returning();

    const removed = await deleteActivity(USER, row.id);

    expect(removed).toBe(true);
    const still = await db.query.activities.findFirst({
      where: eq(schema.activities.id, row.id),
    });
    expect(still).toBeUndefined();
  });

  it("refuses to delete another user's activity and returns false", async () => {
    const { db, schema } = await import("@/lib/db");
    const { deleteActivity } = await import("@/lib/activity-write");
    await db
      .insert(schema.users)
      .values({
        id: "test-activity-write-other-user",
        name: "Other",
        email: "delete-test-other@example.invalid",
      })
      .onConflictDoNothing();
    const [row] = await db
      .insert(schema.activities)
      .values({
        userId: "test-activity-write-other-user",
        provider: "manual",
        externalId: "del-2",
        startDate: new Date(),
        sport: "Ride",
      })
      .returning();

    const removed = await deleteActivity(USER, row.id);

    expect(removed).toBe(false);
    const still = await db.query.activities.findFirst({
      where: eq(schema.activities.id, row.id),
    });
    expect(still).toBeDefined();

    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, "test-activity-write-other-user"));
    await db
      .delete(schema.users)
      .where(eq(schema.users.id, "test-activity-write-other-user"));
  });

  it("returns false for a non-existent activity id", async () => {
    const { deleteActivity } = await import("@/lib/activity-write");
    const removed = await deleteActivity(
      USER,
      "00000000-0000-0000-0000-000000000000"
    );
    expect(removed).toBe(false);
  });
});

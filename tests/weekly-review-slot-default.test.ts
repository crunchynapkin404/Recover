/**
 * The weekly review's slot is Sunday evening.
 *
 * It was Monday 07:00, and that had two costs. The review described a week the
 * athlete had already started living past, and — until runWeekRollovers took
 * the job off it — the review was also the ONLY thing that rolled the week
 * over, so opening Train on a Monday morning showed last week until it ran.
 * Reported from production on 2026-09-07: "today is monday. and the week is
 * still on last week in train." It switched at 08:00, when the review ran.
 *
 * Two separate things are pinned here, because they fail separately:
 * the column default (what a new athlete gets) and the arithmetic that turns
 * it into an instant (what every athlete's review is measured from).
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mostRecentSlot } from "@/lib/weekly-review";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-review-slot-default";

export const SUNDAY = 0;
export const EVENING_HOUR = 18;

describe("the review slot resolves to Sunday evening", () => {
  it("a Monday-morning tick looks back to Sunday evening, not to Monday", () => {
    // The athlete's Monday 06:00. Under the old Monday-07:00 default this
    // resolved to LAST Monday, which is what let the at-most-once guard match
    // last week's review and return before the rollover.
    const slot = mostRecentSlot(
      new Date("2026-09-07T06:00:00"),
      SUNDAY,
      EVENING_HOUR
    );
    expect(slot.getDay()).toBe(SUNDAY);
    expect(slot.getHours()).toBe(EVENING_HOUR);
    // The evening that just passed — hours ago, not eight days.
    expect(slot.toISOString().slice(0, 10)).toBe("2026-09-06");
  });

  it("stays on the Sunday just gone for the whole of the following week", () => {
    for (const iso of [
      "2026-09-07T06:00:00", // Monday
      "2026-09-09T12:00:00", // Wednesday
      "2026-09-12T23:00:00", // Saturday
      "2026-09-13T17:59:00", // Sunday, one minute before the next one
    ]) {
      const slot = mostRecentSlot(new Date(iso), SUNDAY, EVENING_HOUR);
      expect(slot.toISOString().slice(0, 10), `from ${iso}`).toBe("2026-09-06");
    }
    // ...and moves on once the evening arrives.
    expect(
      mostRecentSlot(new Date("2026-09-13T18:01:00"), SUNDAY, EVENING_HOUR)
        .toISOString()
        .slice(0, 10)
    ).toBe("2026-09-13");
  });
});

describe.skipIf(!hasDb)("notification_prefs defaults (migration 0049)", () => {
  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.notificationPrefs)
      .where(eq(schema.notificationPrefs.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("gives a new athlete Sunday evening without being asked", async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.notificationPrefs)
      .where(eq(schema.notificationPrefs.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db.insert(schema.users).values({
      id: USER,
      name: "Slot default",
      email: `${USER}@example.invalid`,
    });
    // No review fields given: the column defaults answer.
    await db.insert(schema.notificationPrefs).values({ userId: USER });

    const row = await db.query.notificationPrefs.findFirst({
      where: eq(schema.notificationPrefs.userId, USER),
    });
    expect(row?.weeklyReviewDay).toBe(SUNDAY);
    expect(row?.weeklyReviewHour).toBe(EVENING_HOUR);
  });
});

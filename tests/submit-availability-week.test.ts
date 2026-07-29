import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-submit-availability-week-user";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: USER, name: "SubmitWeekUser" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// parseDayBlocks (src/lib/availability/parse-day-blocks.ts) reads each
// `blocks-N` field as JSON — a bare minutes string is not valid JSON and
// would be refused as unparseable, tripping submitAvailability's "some of
// that week didn't come through" guard before weekStart is ever read. So
// every day gets a real (possibly empty) block list, matching what the
// live form's hidden inputs actually send (JSON.stringify(blocks)).
function form(weekStart: string | null, mins: number): FormData {
  const fd = new FormData();
  for (let i = 0; i < 7; i++) {
    const blocks =
      i === 2
        ? [
            {
              start: null,
              end: null,
              mins,
              energy: "normal",
              sports: null,
            },
          ]
        : [];
    fd.set(`blocks-${i}`, JSON.stringify(blocks));
  }
  if (weekStart) fd.set("weekStart", weekStart);
  return fd;
}

describe.skipIf(!hasDb)("submitAvailability target week", () => {
  it("writes a future week's overrides without touching any week_plans row", async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db.insert(schema.users).values({
      id: USER,
      name: "SubmitWeekUser",
      email: "submit-availability-week@example.invalid",
      role: "member",
    });

    const before = await db.query.weekPlans.findMany({
      where: eq(schema.weekPlans.userId, USER),
    });

    const { submitAvailability } = await import("@/app/plan/actions");
    // 2027-03-01 is a genuine Monday.
    await submitAvailability({ message: "" }, form("2027-03-01", 120));

    const after = await db.query.weekPlans.findMany({
      where: eq(schema.weekPlans.userId, USER),
    });
    // The invariant that matters: projecting/entering a future week never
    // creates a week_plans row.
    expect(after).toHaveLength(before.length);

    const ov = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, USER),
    });
    expect(ov.some((o) => o.date === "2027-03-03")).toBe(true);

    await db
      .delete(schema.availabilityOverrides)
      .where(eq(schema.availabilityOverrides.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  it("rejects a weekStart that isn't a Monday and writes nothing", async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db.insert(schema.users).values({
      id: USER,
      name: "SubmitWeekUser",
      email: "submit-availability-week@example.invalid",
      role: "member",
    });

    const { submitAvailability } = await import("@/app/plan/actions");
    // 2027-03-02 is a Tuesday.
    const result = await submitAvailability(
      { message: "" },
      form("2027-03-02", 120)
    );
    expect(result.message).toBe(
      "That doesn't look like a Monday. Nothing was changed."
    );

    const ov = await db.query.availabilityOverrides.findMany({
      where: eq(schema.availabilityOverrides.userId, USER),
    });
    expect(ov).toHaveLength(0);

    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  // ── Final-review Finding 1: `weekStart` is compared against the week that
  // is ACTUALLY open, not trusted to mean "future" just because it's
  // present. These three tests share one open week (Monday 2027-03-08) so
  // "equal to", "before", and "after" are all exercised against the same
  // real row. ──────────────────────────────────────────────────────────────
  describe("against a real open week (2027-03-08)", () => {
    const OPEN_WEEK_START = "2027-03-08"; // Monday

    function restDay(date: string) {
      return {
        date,
        availableBlocks: [] as unknown[],
        availableMins: 0,
        workouts: [] as unknown[],
        status: "rest" as const,
      };
    }

    async function seed(): Promise<string> {
      const { db, schema } = await import("@/lib/db");
      await db.delete(schema.users).where(eq(schema.users.id, USER));
      await db.insert(schema.users).values({
        id: USER,
        name: "SubmitWeekUser",
        email: "submit-availability-week@example.invalid",
        role: "member",
      });
      const [plan] = await db
        .insert(schema.trainingPlans)
        .values({
          userId: USER,
          title: "Submit Week Test Plan",
          raceType: "marathon",
          raceDate: "2027-06-01",
          startDate: "2027-01-01",
          weeksTotal: 16,
          currentWeek: 9,
          status: "active",
        })
        .returning();
      const dates = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(OPEN_WEEK_START + "T00:00:00");
        d.setDate(d.getDate() + i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      });
      await db.insert(schema.weekPlans).values({
        userId: USER,
        planId: plan.id,
        weekStart: OPEN_WEEK_START,
        skeletonWeek: 9,
        days: dates.map(restDay),
        status: "open",
        effectiveTarget: 300,
      });
      return plan.id;
    }

    async function cleanup(): Promise<void> {
      const { db, schema } = await import("@/lib/db");
      await db
        .delete(schema.availabilityOverrides)
        .where(eq(schema.availabilityOverrides.userId, USER));
      await db
        .delete(schema.weekPlans)
        .where(eq(schema.weekPlans.userId, USER));
      await db
        .delete(schema.trainingPlans)
        .where(eq(schema.trainingPlans.userId, USER));
      await db.delete(schema.users).where(eq(schema.users.id, USER));
    }

    it("treats a weekStart equal to the open week's own as the current week: replans and returns the current-week message", async () => {
      const { db, schema } = await import("@/lib/db");
      await seed();
      try {
        const { submitAvailability } = await import("@/app/plan/actions");
        const result = await submitAvailability(
          { message: "" },
          form(OPEN_WEEK_START, 120)
        );
        expect(result.message).toBe("Week updated around your availability.");

        const week = await db.query.weekPlans.findFirst({
          where: eq(schema.weekPlans.userId, USER),
        });
        // applyAvailability — the CURRENT-week path — always stamps this,
        // regardless of whether the resolved blocks changed. Before the
        // Finding 1 fix, a weekStart equal to the open week took the
        // future-week branch and this stayed null.
        expect(week?.availabilityConfirmedAt).not.toBeNull();
        const days = week!.days as {
          date: string;
          availableBlocks: unknown[];
        }[];
        // Day index 2's 120-minute block was actually replanned into the
        // stored week, not merely written as an override nobody applied.
        expect(days[2].availableBlocks).toHaveLength(1);
      } finally {
        await cleanup();
      }
    });

    it("rejects a weekStart before the open week's own as a past week and writes nothing", async () => {
      const { db, schema } = await import("@/lib/db");
      await seed();
      try {
        const { submitAvailability } = await import("@/app/plan/actions");
        // 2027-03-01 is the Monday immediately before the open week.
        const result = await submitAvailability(
          { message: "" },
          form("2027-03-01", 120)
        );
        expect(result.message).toBe(
          "That week has already passed. Nothing was changed."
        );

        const ov = await db.query.availabilityOverrides.findMany({
          where: eq(schema.availabilityOverrides.userId, USER),
        });
        expect(ov).toHaveLength(0);

        const week = await db.query.weekPlans.findFirst({
          where: eq(schema.weekPlans.userId, USER),
        });
        // Untouched: not replanned, not even availability-confirmed.
        expect(week?.availabilityConfirmedAt).toBeNull();
      } finally {
        await cleanup();
      }
    });

    it("still only writes overrides — never replans — for a weekStart genuinely after the open week's own", async () => {
      const { db, schema } = await import("@/lib/db");
      await seed();
      try {
        const { submitAvailability } = await import("@/app/plan/actions");
        // 2027-03-15 is a genuine future Monday, one full week after the
        // open week.
        const result = await submitAvailability(
          { message: "" },
          form("2027-03-15", 120)
        );
        expect(result.message).toBe(
          "Next week updated around your availability."
        );

        const ov = await db.query.availabilityOverrides.findMany({
          where: eq(schema.availabilityOverrides.userId, USER),
        });
        expect(ov.some((o) => o.date === "2027-03-17")).toBe(true);

        const week = await db.query.weekPlans.findFirst({
          where: eq(schema.weekPlans.userId, USER),
        });
        // The open week itself must be completely unaffected — "only the
        // current week's submission replans" holds in the other direction
        // too.
        expect(week?.availabilityConfirmedAt).toBeNull();
        expect(week?.weekStart).toBe(OPEN_WEEK_START);
      } finally {
        await cleanup();
      }
    });
  });
});

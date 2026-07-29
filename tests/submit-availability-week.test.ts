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
});

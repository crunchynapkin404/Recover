import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

/**
 * v0.14 Task 15 — /plan race actions. previewPlanChange must be read-only
 * (it powers the DayActions preview step; nothing may persist until
 * applyPlanChange is called), and addRace must reject past dates the same
 * way createRace does.
 *
 * These actions are "use server" + requireUser, so @/lib/session is
 * mocked the same way tests/plan-start-week.test.ts and
 * tests/body-prefs.test.ts do (framework plumbing, not the logic under
 * test). next/cache's revalidatePath throws ("Invariant: static
 * generation store missing") outside a real request context — also
 * stubbed here per the same house pattern, even though the two paths
 * exercised below don't reach it (previewPlanChange never calls it;
 * addRace's past-date rejection returns before it would).
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-plan-actions-race-user";
// A second athlete, used only to prove updateRaceDemand's ownership check —
// requireUser is mocked to always return USER, so this row can never
// legitimately belong to "the caller."
const OTHER_USER = "test-plan-actions-race-other-user";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: USER, name: "ActionUser" }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

function ymd(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.weekPlans).where(eq(schema.weekPlans.userId, USER));
  await db
    .delete(schema.trainingPlans)
    .where(eq(schema.trainingPlans.userId, USER));
  await db.delete(schema.races).where(eq(schema.races.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await db.delete(schema.races).where(eq(schema.races.userId, OTHER_USER));
  await db.delete(schema.users).where(eq(schema.users.id, OTHER_USER));
}

describe.skipIf(!hasDb)("plan race actions", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db.insert(schema.users).values({
      id: USER,
      name: "ActionUser",
      email: "plan-actions-race@example.invalid",
      role: "member",
    });
    const { generateTrainingPlan } = await import("@/lib/training-plan");
    await generateTrainingPlan({
      userId: USER,
      raceType: "10k",
      raceDate: ymd(56),
    });
  });
  afterAll(cleanup);

  it("previewPlanChange returns a delta and saves nothing", async () => {
    const { getOpenWeekPlan } = await import("@/lib/week-plan/service");
    const { previewPlanChange } = await import("@/app/plan/actions");
    const week = await getOpenWeekPlan(USER);
    const from = week!.days.find(
      (d) => d.workouts.length > 0 && d.date > ymd(0)
    );
    if (!from) return; // nothing future to preview this late in the week
    const r = await previewPlanChange({ action: "skip", fromDate: from.date });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.loadDelta).toBeLessThanOrEqual(0);
    const after = await getOpenWeekPlan(USER);
    expect(
      after!.days.find((d) => d.date === from.date)?.workouts[0]
    ).not.toBeUndefined();
  });

  it("addRace validates past dates", async () => {
    const { addRace } = await import("@/app/plan/actions");
    const r = await addRace({
      name: "Old race",
      raceType: "5k",
      date: ymd(-2),
      priority: "C",
      eventDays: 1,
      distanceKm: null,
      elevationM: null,
      stages: [],
    });
    expect(r).toEqual({ ok: false, error: "past_date" });
  });

  /**
   * Task 10 review Finding 4: races-section-demand.test.tsx mocks addRace
   * entirely (it only proves the client sends the right shape), and the
   * past-date test above never reads anything back. These read schema.races
   * and schema.raceStages after the call to prove the server write path
   * actually persists the demand fields field-by-field — swapping
   * distanceKm/elevationM in the actions.ts .set({...}) left all of the
   * shape-only tests passing.
   */
  it("persists event demand and per-day stages field by field, rounding fractional elevation", async () => {
    const { addRace } = await import("@/app/plan/actions");
    const { db, schema } = await import("@/lib/db");
    const date = ymd(40);
    const name = "Stage Race Demand";

    const r = await addRace({
      name,
      raceType: "cycling",
      date,
      priority: "A",
      eventDays: 3,
      distanceKm: 300.5,
      elevationM: 4500.6,
      stages: [
        { dayNumber: 1, distanceKm: 100, elevationM: 1500.4 },
        { dayNumber: 2, distanceKm: 100.25, elevationM: 1500 },
        { dayNumber: 3, distanceKm: 100.25, elevationM: 1500 },
      ],
    });
    expect(r).toEqual({ ok: true });

    const race = await db.query.races.findFirst({
      where: and(eq(schema.races.userId, USER), eq(schema.races.name, name)),
    });
    expect(race).toBeDefined();
    expect(race!.eventDays).toBe(3);
    expect(race!.distanceKm).toBeCloseTo(300.5);
    // elevation_m is an integer column: 4500.6 must round, not truncate or throw.
    expect(race!.elevationM).toBe(4501);

    const stages = (
      await db.query.raceStages.findMany({
        where: eq(schema.raceStages.raceId, race!.id),
      })
    ).sort((a, b) => a.dayNumber - b.dayNumber);
    expect(stages).toHaveLength(3);
    expect(stages[0].distanceKm).toBeCloseTo(100);
    expect(stages[0].elevationM).toBe(1500); // 1500.4 rounds down
    expect(stages[1].distanceKm).toBeCloseTo(100.25);
    expect(stages[1].elevationM).toBe(1500);
    expect(stages[2].dayNumber).toBe(3);
  });

  it("re-submitting the same race with fewer days drops the stale stage rows", async () => {
    const { addRace } = await import("@/app/plan/actions");
    const { db, schema } = await import("@/lib/db");
    const date = ymd(41);
    const name = "Shrinking Stage Race";

    const first = await addRace({
      name,
      raceType: "cycling",
      date,
      priority: "B",
      eventDays: 3,
      distanceKm: 300,
      elevationM: 3000,
      stages: [
        { dayNumber: 1, distanceKm: 100, elevationM: 1000 },
        { dayNumber: 2, distanceKm: 100, elevationM: 1000 },
        { dayNumber: 3, distanceKm: 100, elevationM: 1000 },
      ],
    });
    expect(first).toEqual({ ok: true });

    // Same (userId, date, name) — createRace's upsert key — reuses the row.
    const second = await addRace({
      name,
      raceType: "cycling",
      date,
      priority: "B",
      eventDays: 2,
      distanceKm: 200,
      elevationM: 2000,
      stages: [
        { dayNumber: 1, distanceKm: 100, elevationM: 1000 },
        { dayNumber: 2, distanceKm: 100, elevationM: 1000 },
      ],
    });
    expect(second).toEqual({ ok: true });

    const race = await db.query.races.findFirst({
      where: and(eq(schema.races.userId, USER), eq(schema.races.name, name)),
    });
    expect(race).toBeDefined();
    expect(race!.eventDays).toBe(2);

    const stages = await db.query.raceStages.findMany({
      where: eq(schema.raceStages.raceId, race!.id),
    });
    expect(stages).toHaveLength(2);
    expect(stages.some((s) => s.dayNumber === 3)).toBe(false);
  });

  it("rejects invalid demand values without writing anything", async () => {
    const { addRace } = await import("@/app/plan/actions");
    const { db, schema } = await import("@/lib/db");
    const date = ymd(42);

    const cases: {
      name: string;
      eventDays: number;
      distanceKm: number | null;
      elevationM: number | null;
      stages: {
        dayNumber: number;
        distanceKm: number | null;
        elevationM: number | null;
      }[];
    }[] = [
      {
        name: "Bad Distance Race",
        eventDays: 1,
        distanceKm: -5,
        elevationM: null,
        stages: [],
      },
      {
        name: "Bad Elevation Race",
        eventDays: 1,
        distanceKm: null,
        elevationM: NaN,
        stages: [],
      },
      {
        name: "Bad Elevation Infinity Race",
        eventDays: 1,
        distanceKm: null,
        elevationM: Infinity,
        stages: [],
      },
      {
        // race_stages has a unique index on (raceId, dayNumber). The
        // transaction stops this corrupting anything, but the action's
        // contract is to return errors, not throw them — and it is a
        // reachable "use server" endpoint, so a caller other than our own
        // form can send this.
        name: "Duplicate Stage Day Race",
        eventDays: 2,
        distanceKm: 100,
        elevationM: 100,
        stages: [
          { dayNumber: 1, distanceKm: 10, elevationM: 0 },
          { dayNumber: 1, distanceKm: 20, elevationM: 0 },
        ],
      },
      {
        name: "Bad Stage Day Number Race",
        eventDays: 2,
        distanceKm: 100,
        elevationM: 100,
        stages: [
          { dayNumber: 0, distanceKm: 10, elevationM: 0 },
          { dayNumber: 1, distanceKm: 20, elevationM: 0 },
        ],
      },
      {
        name: "Bad Stage Distance Race",
        eventDays: 2,
        distanceKm: 100,
        elevationM: 100,
        stages: [
          { dayNumber: 1, distanceKm: -10, elevationM: 0 },
          { dayNumber: 2, distanceKm: 10, elevationM: 0 },
        ],
      },
      {
        name: "Bad Stage Elevation Race",
        eventDays: 2,
        distanceKm: 100,
        elevationM: 100,
        stages: [
          { dayNumber: 1, distanceKm: 10, elevationM: NaN },
          { dayNumber: 2, distanceKm: 10, elevationM: 0 },
        ],
      },
      {
        name: "Bad Event Days Race",
        eventDays: 0,
        distanceKm: null,
        elevationM: null,
        stages: [],
      },
    ];

    for (const c of cases) {
      const r = await addRace({
        name: c.name,
        raceType: "cycling",
        date,
        priority: "C",
        eventDays: c.eventDays,
        distanceKm: c.distanceKm,
        elevationM: c.elevationM,
        stages: c.stages,
      });
      expect(r.ok, `case ${c.name} should be rejected`).toBe(false);

      const rows = await db.query.races.findMany({
        where: and(
          eq(schema.races.userId, USER),
          eq(schema.races.name, c.name)
        ),
      });
      expect(rows, `case ${c.name} must not write a race row`).toHaveLength(0);
    }
  });

  // Final-review Finding I6 part 2: correcting a race's stored demand used
  // to mean deleting the race and re-adding it. updateRaceDemand is the new
  // action — these prove it actually persists a correction, shares addRace's
  // validation, and cannot be pointed at another athlete's race.
  describe("updateRaceDemand", () => {
    it("corrects an existing race's demand and replaces its stages", async () => {
      const { addRace, updateRaceDemand } = await import("@/app/plan/actions");
      const { db, schema } = await import("@/lib/db");
      const date = ymd(43);
      const name = "Typo Elevation Race";

      const created = await addRace({
        name,
        raceType: "cycling",
        date,
        priority: "B",
        eventDays: 1,
        distanceKm: 100,
        // The exact defect Finding I6 exists to fix: a 20,000m typo for
        // 2,000m, with no prior way to see or correct it in place.
        elevationM: 20000,
        stages: [],
      });
      expect(created).toEqual({ ok: true });

      const race = await db.query.races.findFirst({
        where: and(eq(schema.races.userId, USER), eq(schema.races.name, name)),
      });
      expect(race).toBeDefined();
      expect(race!.elevationM).toBe(20000);

      const result = await updateRaceDemand(race!.id, {
        eventDays: 2,
        distanceKm: 100,
        elevationM: 2000,
        stages: [
          { dayNumber: 1, distanceKm: 50, elevationM: 1000 },
          { dayNumber: 2, distanceKm: 50, elevationM: 1000 },
        ],
      });
      expect(result).toEqual({ ok: true });

      const corrected = await db.query.races.findFirst({
        where: eq(schema.races.id, race!.id),
      });
      expect(corrected!.elevationM).toBe(2000);
      expect(corrected!.eventDays).toBe(2);

      const stages = (
        await db.query.raceStages.findMany({
          where: eq(schema.raceStages.raceId, race!.id),
        })
      ).sort((a, b) => a.dayNumber - b.dayNumber);
      expect(stages).toHaveLength(2);
      expect(stages[0].elevationM).toBe(1000);
    });

    it("rejects invalid demand values without writing anything, same rules as addRace", async () => {
      const { addRace, updateRaceDemand } = await import("@/app/plan/actions");
      const { db, schema } = await import("@/lib/db");
      const date = ymd(44);
      const name = "Update Validation Race";

      const created = await addRace({
        name,
        raceType: "cycling",
        date,
        priority: "C",
        eventDays: 1,
        distanceKm: 50,
        elevationM: 500,
        stages: [],
      });
      expect(created).toEqual({ ok: true });
      const race = await db.query.races.findFirst({
        where: and(eq(schema.races.userId, USER), eq(schema.races.name, name)),
      });

      const result = await updateRaceDemand(race!.id, {
        eventDays: 1,
        distanceKm: -10,
        elevationM: null,
        stages: [],
      });
      expect(result).toEqual({
        ok: false,
        error: "Distance cannot be negative.",
      });

      const unchanged = await db.query.races.findFirst({
        where: eq(schema.races.id, race!.id),
      });
      expect(unchanged!.distanceKm).toBeCloseTo(50);
    });

    it("cannot be pointed at another athlete's race", async () => {
      const { updateRaceDemand } = await import("@/app/plan/actions");
      const { db, schema } = await import("@/lib/db");

      await db
        .insert(schema.users)
        .values({
          id: OTHER_USER,
          name: "OtherAthlete",
          email: `${OTHER_USER}@example.invalid`,
          role: "member",
        })
        .onConflictDoNothing();
      const [otherRace] = await db
        .insert(schema.races)
        .values({
          userId: OTHER_USER,
          name: "Not Yours",
          raceType: "cycling",
          date: ymd(45),
          priority: "B",
          distanceKm: 100,
          elevationM: 1000,
        })
        .returning();

      const result = await updateRaceDemand(otherRace.id, {
        eventDays: 1,
        distanceKm: 999,
        elevationM: 9999,
        stages: [],
      });
      expect(result.ok).toBe(false);

      const untouched = await db.query.races.findFirst({
        where: eq(schema.races.id, otherRace.id),
      });
      expect(untouched!.distanceKm).toBeCloseTo(100);
      expect(untouched!.elevationM).toBe(1000);
    });

    it("updateRaceDemand sets, clears, and preserves the goal", async () => {
      const { db, schema } = await import("@/lib/db");
      const { updateRaceDemand } = await import("@/app/plan/actions");
      const { createRace } = await import("@/lib/race/service");

      const created = await createRace(USER, {
        name: "Goal Edit Race",
        raceType: "gran fondo",
        date: ymd(50),
        priority: "A",
      });
      const raceId = (created as { race: { id: string } }).race.id;
      const demand = {
        eventDays: 1,
        distanceKm: 120,
        elevationM: 2000,
        stages: [],
      };

      // Set it — the case the athlete was blocked on: the add form is the only
      // place goalNote has ever had an input.
      expect(
        await updateRaceDemand(raceId, { ...demand, goalNote: "sub 4h" })
      ).toEqual({ ok: true });
      expect(
        (await db.query.races.findFirst({ where: eq(schema.races.id, raceId) }))
          ?.goalNote
      ).toBe("sub 4h");

      // Omitted — a demand-only correction must not erase a goal already set.
      expect(await updateRaceDemand(raceId, demand)).toEqual({ ok: true });
      expect(
        (await db.query.races.findFirst({ where: eq(schema.races.id, raceId) }))
          ?.goalNote
      ).toBe("sub 4h");

      // Blanked — an athlete clearing the field means clear it, and whitespace
      // is blank. Stored as null, not "", so `race.goalNote && ...` renders
      // nothing rather than an empty line.
      expect(
        await updateRaceDemand(raceId, { ...demand, goalNote: "   " })
      ).toEqual({ ok: true });
      expect(
        (await db.query.races.findFirst({ where: eq(schema.races.id, raceId) }))
          ?.goalNote
      ).toBeNull();

      // Null — set a goal again first, so this proves literal null actually
      // clears a previously-set goal rather than confirming an already-null
      // column.
      expect(
        await updateRaceDemand(raceId, { ...demand, goalNote: "sub 4h again" })
      ).toEqual({ ok: true });
      expect(
        await updateRaceDemand(raceId, { ...demand, goalNote: null })
      ).toEqual({ ok: true });
      expect(
        (await db.query.races.findFirst({ where: eq(schema.races.id, raceId) }))
          ?.goalNote
      ).toBeNull();
    });
  });
});

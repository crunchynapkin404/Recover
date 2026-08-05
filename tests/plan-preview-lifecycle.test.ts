import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { eventDemand } from "@/lib/race/demand";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("previewTrainingPlan (v0.43)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db").schema;
  let previewTrainingPlan: typeof import("@/lib/training-plan").previewTrainingPlan;
  const userId = `preview-${Date.now()}`;

  /** 20 weeks out, so the plan is a normal length. */
  function raceDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 20 * 7);
    return d.toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    ({ db, schema } = await import("@/lib/db"));
    ({ previewTrainingPlan } = await import("@/lib/training-plan"));
    await db.insert(schema.users).values({
      id: userId,
      name: "Preview Test",
      email: `${userId}@example.invalid`,
    });
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("writes a draft and touches nothing else", async () => {
    const [existing] = await db
      .insert(schema.trainingPlans)
      .values({
        userId,
        title: "the plan they already have",
        raceType: "gran_fondo",
        raceDate: raceDate(),
        startDate: "2026-08-05",
        weeksTotal: 12,
        status: "active",
      })
      .returning();

    const result = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The existing plan is untouched.
    const after = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, existing.id),
    });
    expect(after?.status).toBe("active");

    // The draft exists, with blocks.
    const draft = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, result.preview.planId),
    });
    expect(draft?.status).toBe("draft");
    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, result.preview.planId),
    });
    expect(blocks.length).toBe(result.preview.weeksTotal);

    // Exactly one row was added — the pre-existing active plan plus the one
    // new draft, never a second draft or a duplicate insert of either.
    const allPlans = await db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, userId),
    });
    expect(allPlans).toHaveLength(2);

    // Nothing else was written.
    const races = await db.query.races.findMany({
      where: eq(schema.races.userId, userId),
    });
    expect(races).toHaveLength(0);
    const avail = await db.query.availabilityDefaults.findMany({
      where: eq(schema.availabilityDefaults.userId, userId),
    });
    expect(avail).toHaveLength(0);
    const weeks = await db.query.weekPlans.findMany({
      where: eq(schema.weekPlans.userId, userId),
    });
    expect(weeks).toHaveLength(0);
  });

  it("replaces the previous draft rather than accumulating", async () => {
    const first = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
    });
    const second = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const drafts = await db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, userId),
    });
    expect(drafts.filter((p) => p.status === "draft")).toHaveLength(1);

    const orphaned = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, first.preview.planId),
    });
    expect(orphaned).toHaveLength(0);
  });

  it("refuses a race type that names no sport, without throwing", async () => {
    const result = await previewTrainingPlan({
      userId,
      raceType: "underwater_basket_weaving",
      raceDate: raceDate(),
    });
    expect(result).toEqual({ ok: false, reason: "unknown_sport" });
  });

  // periodize does NOT special-case a short horizon into a taper-only plan —
  // Task 3 established that a plan this short collapses entirely into base
  // (see plan-preview.ts's PHASE_ORDER comment and the Task 3 report). The
  // `short_horizon` warning is what carries the honesty here, not a reshaped
  // phase list, so this asserts the real (all-base) shape rather than the
  // taper-only one a naive reading of "shortened plan" might expect.
  it("scales a close race instead of refusing it — and does not fake a taper", async () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 14);
    const result = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: soon.toISOString().slice(0, 10),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.warnings).toContain("short_horizon");
    expect(result.preview.weeksTotal).toBeLessThan(4);
    expect(result.preview.weeksTotal).toBe(2);
    // The honest shape for a 2-week horizon: both weeks land in "base",
    // never "taper" — periodize's phase floors overrun a plan this short,
    // but the loop bound (`w <= weeksTotal`) cuts it off before build,
    // peak or taper are ever reached.
    expect(result.preview.phases).toEqual([
      { phase: "base", weeks: 2, weekNumbers: [1, 2] },
    ]);
  });

  it("phase rows sum to the plan's week count", async () => {
    const result = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summed = result.preview.phases.reduce((s, r) => s + r.weeks, 0);
    expect(summed).toBe(result.preview.weeksTotal);
  });

  // Vacuous `toHaveProperty("feasibility")` would pass on a typo. This
  // fixture instead gives the athlete a real upcoming race (with distance,
  // elevation and FTP, so `eventDemand` returns non-null) and enough recent
  // activity history that `assessFeasibility` has both a current-hours and a
  // longest-ride figure to work with, then asserts the actual verdict —
  // computed independently here via the same pure `eventDemand` function the
  // implementation calls, so the expected numbers cannot drift from a
  // hand-typed guess.
  it("carries a real feasibility verdict when the inputs exist", async () => {
    const ftpWatts = 250;
    const distanceKm = 120;
    const elevationM = 2000;

    await db.insert(schema.bodyPrefs).values({ userId, ftpWatts });

    const feasibilityRaceDate = raceDate();
    await db.insert(schema.races).values({
      userId,
      name: "Feasibility Test Race",
      raceType: "gran_fondo",
      sport: "Bike",
      date: feasibilityRaceDate,
      priority: "A",
      status: "upcoming",
      eventDays: 1,
      distanceKm,
      elevationM,
    });

    // Same inputs `assembleVolumeInputs` will pass to `eventDemand` for this
    // race (no weight on file, so massKg is null → the function's own
    // default), computed here independently to derive an activity duration
    // that is comfortably feasible — never a guessed constant.
    const demand = eventDemand({
      eventDays: 1,
      distanceKm,
      elevationM,
      stages: [],
      overrideWeeklyHours: null,
      ftpWatts,
      massKg: null,
    });
    expect(demand).not.toBeNull();
    if (!demand) return;

    // One ride, comfortably above both what the event's weekly demand asks
    // for and 80% of its queen-stage hours (the longest-ride requirement) —
    // it is simultaneously the peak week and the longest ride on file, so it
    // drives both `level.peakHours` and `longestRideHours` to the same
    // value.
    const activityHours = demand.weeklyHours * 1.5;
    await db.insert(schema.activities).values({
      userId,
      provider: "manual",
      externalId: `feasibility-${userId}`,
      startDate: new Date(),
      sport: "Bike",
      durationS: Math.round(activityHours * 3600),
    });

    const result = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: feasibilityRaceDate,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.feasibility).not.toBeNull();
    expect(result.preview.feasibility?.verdict).toBe("ready");
    expect(result.preview.warnings).not.toContain("feasibility_tight");
    expect(result.preview.warnings).not.toContain("feasibility_not_realistic");
  });
});

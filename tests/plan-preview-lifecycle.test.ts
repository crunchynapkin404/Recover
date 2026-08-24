import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { eventDemand } from "@/lib/race/demand";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("previewTrainingPlan (v0.43)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db").schema;
  let previewTrainingPlan: typeof import("@/lib/training-plan").previewTrainingPlan;
  let previewFromDraft: typeof import("@/lib/training-plan").previewFromDraft;
  const userId = `preview-${Date.now()}`;
  const otherUserId = `preview-other-${Date.now()}`;

  /** 20 weeks out, so the plan is a normal length. */
  function raceDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 20 * 7);
    return d.toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    ({ db, schema } = await import("@/lib/db"));
    ({ previewTrainingPlan, previewFromDraft } =
      await import("@/lib/training-plan"));
    await db.insert(schema.users).values([
      { id: userId, name: "Preview Test", email: `${userId}@example.invalid` },
      {
        id: otherUserId,
        name: "Someone Else",
        email: `${otherUserId}@example.invalid`,
      },
    ]);
  });

  afterAll(async () => {
    // Cascades to each user's own races (races.userId references users with
    // onDelete: "cascade").
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.users).where(eq(schema.users.id, otherUserId));
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
      {
        segment: 1,
        phase: "base",
        weeks: 2,
        weekNumbers: [1, 2],
        isBridge: false,
      },
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
      sport: "Bike",
      raceType: "gran_fondo",
      eventDays: 1,
      distanceKm,
      elevationM,
      stages: [],
      overrideWeeklyHours: null,
      expectedFinishHours: null,
      ftp: { watts: ftpWatts, source: "outdoor" as const },
      massKg: null,
      runPace: null,
      swimPace: null,
    });
    expect(demand.available).toBe(true);
    if (!demand.available) return;

    // One ride, comfortably above both what the event's weekly demand asks
    // for and 80% of its queen-stage hours (the longest-session requirement) —
    // it is simultaneously the peak week and the longest session on file, so
    // it drives both `level.peakHours` and `longestSessionHours` to the same
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

  // Finding 1 (review): targetHours used to be back-calculated from a ratio
  // pinned to week 1 (`blocks[0].targetLoad / hoursPerWeek`), which drifted
  // hard from what was actually scheduled by the back half of a plan —
  // `targetLoad` compounds through `periodize`'s own progression while
  // scheduled minutes follow a differently-shaped `loadMultiplier`. A test
  // that only checked week 1 would have passed the broken code (week 1's
  // ratio is exact by construction), so this checks every week — including
  // asserting a peak and a taper week are actually present in the sample —
  // against the ONE ground truth: the minutes the stored blocks actually
  // schedule.
  it("targetHours equals that week's summed workout durations, not a week-1 ratio", async () => {
    const result = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, result.preview.planId),
    });
    expect(blocks.length).toBe(result.preview.weeksTotal);

    const blocksByWeek = new Map(blocks.map((b) => [b.weekNumber, b]));
    for (const week of result.preview.weeks) {
      const block = blocksByWeek.get(week.weekNumber);
      expect(block).toBeTruthy();
      const workouts = (block?.workouts ?? []) as { durationMins: number }[];
      const summedHours =
        Math.round(
          (workouts.reduce((s, w) => s + w.durationMins, 0) / 60) * 10
        ) / 10;
      expect(week.targetHours).toBe(summedHours);
    }

    // Guard the test itself against vacuity: if periodize's shape ever
    // changed such that this horizon produced only base/build weeks, the
    // loop above would still pass without ever having exercised the
    // compounding phases where the old ratio drifted worst.
    const phasesSeen = new Set(result.preview.weeks.map((w) => w.phase));
    expect(phasesSeen.has("peak")).toBe(true);
    expect(phasesSeen.has("taper")).toBe(true);
  });

  // Finding 2 (review): race_not_found via a raceId that simply does not
  // exist.
  it("refuses a raceId that does not exist", async () => {
    const result = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
      raceId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, reason: "race_not_found" });
  });

  // Finding 2 (review): the security-relevant case — a raceId that exists
  // but belongs to a different user. The lookup is scoped by
  // `and(eq(races.id, raceId), eq(races.userId, userId))`, so this must come
  // back exactly like "does not exist", not leak the other athlete's race.
  it("refuses a raceId that belongs to another user", async () => {
    const [othersRace] = await db
      .insert(schema.races)
      .values({
        userId: otherUserId,
        name: "Someone Else's Race",
        raceType: "marathon",
        sport: "Run",
        date: raceDate(),
        priority: "A",
      })
      .returning();

    const result = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
      raceId: othersRace.id,
    });
    expect(result).toEqual({ ok: false, reason: "race_not_found" });
  });

  // Finding 2 (review): horizon_too_long.
  it("refuses a race date more than 52 weeks out", async () => {
    const farAway = new Date();
    farAway.setDate(farAway.getDate() + 53 * 7);
    const result = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: farAway.toISOString().slice(0, 10),
    });
    expect(result).toEqual({ ok: false, reason: "horizon_too_long" });
  });

  // Finding 2 (review): the raceId-provided branch generally — no test
  // exercised it at all before. `raceType` and `raceDate` are set to values
  // that would be WRONG if the race row's own fields weren't the ones that
  // actually won ("gran_fondo" infers Bike; the race's real sport is Run),
  // so a regression that fell back to param-inference here would be caught,
  // not silently agree by coincidence.
  it("drives the plan from the race row when raceId is given, not from raceType inference", async () => {
    const [race] = await db
      .insert(schema.races)
      .values({
        userId,
        name: "Race-Driven Plan Race",
        raceType: "gran_fondo", // would infer "Bike" if this were used
        sport: "Run", // the race's actual sport — this must win
        date: raceDate(),
        priority: "B",
      })
      .returning();

    const result = await previewTrainingPlan({
      userId,
      raceId: race.id,
      raceType: "irrelevant_placeholder",
      raceDate: "2000-01-01",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.sport).toBe("Run");
    expect(result.preview.race.id).toBe(race.id);
    expect(result.preview.race.name).toBe("Race-Driven Plan Race");
    expect(result.preview.warnings).not.toContain("race_created");
  });

  // Finding 2 (v0.43 final review): with no title and no raceId — the
  // common first-generation path — the in-memory race name
  // `previewTrainingPlan` returns to the coach used to default independently
  // from the stored `title` that `previewFromDraft` reads for /train, so the
  // same draft was called "gran_fondo" in one place and "gran_fondo training
  // plan" in the other. Rehydrating the very draft this call just wrote and
  // comparing the two callers' race names is what would catch that
  // divergence again; the exact-string assertion guards against both sides
  // having simply moved to agree on a DIFFERENT wrong value.
  it("names an untitled, race-less draft the same way to the coach and on /train", async () => {
    const result = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const draftRow = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, result.preview.planId),
    });
    expect(draftRow).toBeTruthy();
    if (!draftRow) return;

    const rehydrated = await previewFromDraft(draftRow);
    expect(rehydrated.race.name).toBe(result.preview.race.name);
    expect(result.preview.race.name).toBe("gran_fondo training plan");
  });
});

describe.skipIf(!hasDb)("confirmTrainingPlan (v0.43)", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db").schema;
  let previewTrainingPlan: typeof import("@/lib/training-plan").previewTrainingPlan;
  let confirmTrainingPlan: typeof import("@/lib/training-plan").confirmTrainingPlan;
  let getActivePlan: typeof import("@/lib/active-plan").getActivePlan;
  const userId = `confirm-${Date.now()}`;

  function raceDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 20 * 7);
    return d.toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    ({ db, schema } = await import("@/lib/db"));
    ({ previewTrainingPlan, confirmTrainingPlan } =
      await import("@/lib/training-plan"));
    ({ getActivePlan } = await import("@/lib/active-plan"));
    await db.insert(schema.users).values({
      id: userId,
      name: "Confirm Test",
      email: `${userId}@example.invalid`,
    });
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("archives the old plan and activates the draft", async () => {
    const [old] = await db
      .insert(schema.trainingPlans)
      .values({
        userId,
        title: "old",
        raceType: "gran_fondo",
        raceDate: raceDate(),
        startDate: "2026-08-05",
        weeksTotal: 12,
        status: "active",
      })
      .returning();

    const preview = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const confirmed = await confirmTrainingPlan(userId, preview.preview.planId);
    expect(confirmed).toEqual({ ok: true, planId: preview.preview.planId });

    const oldAfter = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, old.id),
    });
    expect(oldAfter?.status).toBe("archived");

    const active = await getActivePlan(userId);
    expect(active?.id).toBe(preview.preview.planId);
  });

  it("refuses a plan that is not this athlete's draft", async () => {
    const active = await getActivePlan(userId);
    expect(active).not.toBeNull();
    // Already active, so no longer confirmable.
    expect(await confirmTrainingPlan(userId, active!.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("creates the race the preview promised", async () => {
    // A title distinct from the earlier test's: previewTrainingPlan defaults
    // the title to `${raceType} training plan` and raceDate() is the same
    // calendar day for every test in this file, so without this the race
    // this test's own confirm creates would collide with the one "archives
    // the old plan and activates the draft" already left behind for this
    // same user on `races_user_date_name_uq` (user_id, date, name) — a
    // fixture collision, not anything confirmTrainingPlan gets wrong.
    const preview = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
      title: "confirm-race-created-check",
    });
    if (!preview.ok) throw new Error("preview failed");
    expect(preview.preview.race.id).toBeNull();
    expect(preview.preview.warnings).toContain("race_created");

    await confirmTrainingPlan(userId, preview.preview.planId);

    // Scoped by this test's own unique title, not just userId: the earlier
    // "archives the old plan and activates the draft" test's own confirm
    // already left one race behind for this same shared user, so a bare
    // userId filter would count that one too.
    const races = await db.query.races.findMany({
      where: and(
        eq(schema.races.userId, userId),
        eq(schema.races.name, "confirm-race-created-check")
      ),
    });
    expect(races).toHaveLength(1);
    expect(races[0].sport).toBe("Bike");
    expect(races[0].priority).toBe("A");

    const plan = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, preview.preview.planId),
    });
    expect(plan?.raceId).toBe(races[0].id);
  });

  it("leaves the previous plan active when the transaction fails", async () => {
    const [survivor] = await db
      .insert(schema.trainingPlans)
      .values({
        userId,
        title: "must survive",
        raceType: "gran_fondo",
        raceDate: raceDate(),
        startDate: "2026-08-05",
        weeksTotal: 12,
        status: "active",
      })
      .returning();

    // Distinct title so this test's own draft race doesn't collide with an
    // earlier test's leftover race for this user (see the comment on
    // "creates the race the preview promised") before we get to the
    // collision this test is actually planting on purpose, below.
    const preview = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
      title: "confirm-atomicity-check",
    });
    if (!preview.ok) throw new Error("preview failed");

    // Make the race insert fail for real, with no mocking: races carry a
    // unique index on (user_id, date, name) — `races_user_date_name_uq` in
    // schema.ts — so planting a race with the draft's own title and date
    // makes confirmation's insert collide. The archive has already run by
    // then, so without a transaction `survivor` ends up archived and the
    // athlete has no active plan: the exact failure this release closes.
    const draftRow = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, preview.preview.planId),
    });
    await db.insert(schema.races).values({
      userId,
      name: draftRow!.title,
      raceType: draftRow!.raceType,
      sport: "Bike",
      date: draftRow!.raceDate,
      priority: "B",
    });

    await expect(
      confirmTrainingPlan(userId, preview.preview.planId)
    ).rejects.toThrow();

    const after = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, survivor.id),
    });
    expect(after?.status).toBe("active");

    const draftAfter = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, preview.preview.planId),
    });
    expect(draftAfter?.status).toBe("draft");
  });

  it("does not overwrite an existing standard week", async () => {
    // onConflictDoUpdate rather than a bare insert: the earlier tests in
    // this describe block already confirmed drafts for this same user, and
    // confirmTrainingPlan's own seedAvailabilityDefaults call fills every
    // weekday with onConflictDoNothing on its first run — so a weekday-0 row
    // already exists by the time this test runs. Updating it to exactly the
    // custom blocks this test is about, rather than assuming no row exists
    // yet, sets up the real scenario this test asserts on (an athlete's own
    // schedule already sitting there) regardless of that fixture history.
    await db
      .insert(schema.availabilityDefaults)
      .values({
        userId,
        weekday: 0,
        blocks: [{ start: "06:00", end: "07:00", sports: null }],
      })
      .onConflictDoUpdate({
        target: [
          schema.availabilityDefaults.userId,
          schema.availabilityDefaults.weekday,
        ],
        set: { blocks: [{ start: "06:00", end: "07:00", sports: null }] },
      });

    // Distinct title, same reason as the earlier tests above: avoids
    // colliding with a leftover race from this same shared user.
    const preview = await previewTrainingPlan({
      userId,
      raceType: "gran_fondo",
      raceDate: raceDate(),
      title: "confirm-avail-check",
    });
    if (!preview.ok) throw new Error("preview failed");
    await confirmTrainingPlan(userId, preview.preview.planId);

    const monday = await db.query.availabilityDefaults.findFirst({
      where: and(
        eq(schema.availabilityDefaults.userId, userId),
        eq(schema.availabilityDefaults.weekday, 0)
      ),
    });
    expect(monday?.blocks).toEqual([
      { start: "06:00", end: "07:00", sports: null },
    ]);
  });

  // Finding 1 (v0.43 final review): a draft's sport is frozen into
  // `constraints.sports` when the draft is written and never re-checked.
  // `upsert_race` — untouched by this release — lets the coach change an
  // existing race's sport at any time, so previewing against a Bike race
  // and then correcting that race to Run must not let confirmation activate
  // the (now sport-mismatched) Bike plan.
  it("refuses when the race's sport changed after the draft was made, activating and archiving nothing", async () => {
    // This test's own active plan, distinctly titled so it cannot collide
    // with a leftover row from an earlier test in this shared-user describe
    // block, and checked directly by id below rather than via
    // getActivePlan — this user may already carry other active/draft rows
    // left behind by earlier tests here.
    const [survivor] = await db
      .insert(schema.trainingPlans)
      .values({
        userId,
        title: "must survive a sport change",
        raceType: "gran_fondo",
        raceDate: raceDate(),
        startDate: "2026-08-05",
        weeksTotal: 12,
        status: "active",
      })
      .returning();

    const [race] = await db
      .insert(schema.races)
      .values({
        userId,
        name: "Sport Change Check Race",
        raceType: "gran_fondo",
        sport: "Bike",
        date: raceDate(),
        priority: "A",
      })
      .returning();

    const preview = await previewTrainingPlan({
      userId,
      raceId: race.id,
      raceType: "irrelevant_placeholder",
      raceDate: "2000-01-01",
    });
    if (!preview.ok) throw new Error("preview failed");
    expect(preview.preview.sport).toBe("Bike");

    // The coach corrects the race's sport — exactly the door Finding 1
    // closes: upsert_race is untouched by this release.
    await db
      .update(schema.races)
      .set({ sport: "Run" })
      .where(eq(schema.races.id, race.id));

    const confirmed = await confirmTrainingPlan(userId, preview.preview.planId);
    expect(confirmed).toEqual({ ok: false, reason: "sport_changed" });

    // No plan was activated: the draft is still exactly a draft.
    const draftAfter = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, preview.preview.planId),
    });
    expect(draftAfter?.status).toBe("draft");

    // The previous plan was not archived.
    const survivorAfter = await db.query.trainingPlans.findFirst({
      where: eq(schema.trainingPlans.id, survivor.id),
    });
    expect(survivorAfter?.status).toBe("active");
  });
});

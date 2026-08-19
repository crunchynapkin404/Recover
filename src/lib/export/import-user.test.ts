import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

// Matches export-user.test.ts: no separate test DB, so every row here is
// test-* scoped and cleaned up via FK cascade off the seeded users rows.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const SOURCE_USER = "test-export-user";
const TARGET_USER = "test-import-user";

describe.skipIf(!hasDb)("importUserData", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");

    await db
      .insert(schema.users)
      .values([
        {
          id: SOURCE_USER,
          name: "Import Test Source",
          email: "import-test-source@example.invalid",
        },
        {
          id: TARGET_USER,
          name: "Import Test Target",
          email: "import-test-target@example.invalid",
        },
      ])
      .onConflictDoNothing();

    // Seed the SOURCE user with data across every exported table,
    // deliberately populating the three nullable cross-table FKs
    // (activities.debriefThreadId, races.resultActivityId,
    // trainingPlans.raceId) so the test actually exercises the corrected
    // FK insert order / remap logic in importUserData, not just the
    // plain-userId tables.
    await db.insert(schema.wellnessDaily).values({
      userId: SOURCE_USER,
      date: "2026-01-02",
      hrvMs: 55,
      notes: "felt good",
      // vo2max is one of nine wellness_daily columns (5 new to this branch
      // plus 4 pre-existing) that importUserData's explicit insert column
      // list previously omitted — seeded with a real value here so the
      // round-trip assertion below actually exercises the fix instead of
      // just checking row counts.
      vo2max: 48.2,
    });
    await db.insert(schema.dailyMetrics).values({
      userId: SOURCE_USER,
      date: "2026-01-02",
      readiness: 72,
      band: "green",
    });
    await db
      .insert(schema.bodyPrefs)
      .values({ userId: SOURCE_USER, maxHr: 190 });
    await db.insert(schema.notificationPrefs).values({ userId: SOURCE_USER });
    await db
      .insert(schema.journalPrefs)
      .values({ userId: SOURCE_USER, usualBehaviorTags: ["caffeine"] });
    await db.insert(schema.surfaceViews).values({
      userId: SOURCE_USER,
      surface: "train",
      day: "2026-01-10",
      count: 5,
    });
    await db.insert(schema.llmSettings).values({
      userId: SOURCE_USER,
      providerType: "anthropic",
      model: "claude-sonnet",
      encryptedApiKey: "SECRET-SHOULD-NOT-IMPORT",
      coachLanguage: "nl",
    });
    await db.insert(schema.biomarkers).values({
      userId: SOURCE_USER,
      name: "ldl_cholesterol",
      displayName: "LDL Cholesterol",
      value: 95,
      measuredAt: "2026-01-01",
      source: "manual",
    });
    await db.insert(schema.llmUsage).values({
      userId: SOURCE_USER,
      model: "claude-sonnet",
      slot: "deep",
      purpose: "chat",
      inputTokens: 100,
      outputTokens: 50,
    });
    await db.insert(schema.coachMemories).values({
      userId: SOURCE_USER,
      category: "goal",
      content: "sub-3 marathon",
    });

    const [thread] = await db
      .insert(schema.chatThreads)
      .values({ userId: SOURCE_USER, title: "IMPORT-TEST-THREAD" })
      .returning();
    await db.insert(schema.chatMessages).values([
      { threadId: thread.id, role: "user", content: "hello" },
      { threadId: thread.id, role: "assistant", content: "hi there" },
    ]);

    // Activity links back to the thread (debriefThreadId) — proves
    // activities is inserted after chat_threads with correct remap.
    const [activity] = await db
      .insert(schema.activities)
      .values({
        userId: SOURCE_USER,
        provider: "manual",
        externalId: "import-test-ext-1",
        startDate: new Date("2026-01-02T08:00:00Z"),
        // Local Date constructor (not a UTC ISO string) so the paired
        // assertion via local getters is TZ-agnostic — matches the house
        // pattern in src/lib/training-load.test.ts. Distinct wall-clock
        // from startDate above proves the round-trip carries local time
        // forward, not just re-deriving it from the UTC instant.
        startDateLocal: new Date(2026, 0, 2, 14, 30, 0),
        sport: "Ride",
        name: "IMPORT-TEST-ACTIVITY",
        debriefThreadId: thread.id,
        debriefState: "answered",
      })
      .returning();
    await db.insert(schema.activityStreams).values({
      activityId: activity.id,
      type: "heartrate",
      data: { series: [120, 125, 130] },
    });

    // Race links back to the activity (resultActivityId) — proves races is
    // inserted after activities with correct remap.
    const [race] = await db
      .insert(schema.races)
      .values({
        userId: SOURCE_USER,
        name: "IMPORT-TEST-RACE",
        raceType: "10k",
        sport: "Run",
        date: "2026-06-01",
        priority: "A",
        status: "completed",
        resultActivityId: activity.id,
      })
      .returning();

    // A second, EARLIER A-race — the plan's firstRaceId. Task 5 fix round 1:
    // proves the GDPR round-trip carries the second race too, not just the
    // plan's final target (raceId).
    const [raceOne] = await db
      .insert(schema.races)
      .values({
        userId: SOURCE_USER,
        name: "IMPORT-TEST-RACE-ONE",
        raceType: "5k",
        sport: "Run",
        date: "2026-03-01",
        priority: "A",
        status: "completed",
      })
      .returning();

    // Training plan links back to both races (raceId = final target,
    // firstRaceId = the earlier race) — proves training_plans is inserted
    // after races with BOTH FKs correctly remapped.
    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: SOURCE_USER,
        title: "IMPORT-TEST-PLAN",
        raceType: "10k",
        raceDate: "2026-06-01",
        startDate: "2026-01-01",
        weeksTotal: 12,
        raceId: race.id,
        firstRaceId: raceOne.id,
        firstRaceDate: raceOne.date,
        firstRaceType: raceOne.raceType,
      })
      .returning();
    await db.insert(schema.trainingBlocks).values({
      planId: plan.id,
      weekNumber: 1,
      phase: "base",
      workouts: [{ day: "mon", kind: "easy" }],
    });

    const [weekPlan] = await db
      .insert(schema.weekPlans)
      .values({
        userId: SOURCE_USER,
        planId: plan.id,
        weekStart: "2026-01-01",
        skeletonWeek: 1,
        days: [{ day: "mon", kind: "easy" }],
      })
      .returning();
    await db.insert(schema.planAdjustments).values({
      weekPlanId: weekPlan.id,
      date: "2026-01-03",
      trigger: "low_readiness",
      action: "scaled",
      reason: "readiness dropped",
    });

    // Secret-bearing rows — must NOT be imported (see import-user.ts's
    // header comment: NOT NULL secret columns absent from the export).
    await db.insert(schema.apiTokens).values({
      userId: SOURCE_USER,
      tokenHash: "SECRET-TOKEN-HASH-SHOULD-NOT-IMPORT",
      lookupPrefix: "abcd1234",
      label: "My token",
    });
    await db.insert(schema.connections).values({
      userId: SOURCE_USER,
      provider: "strava",
      encryptedAccessToken: "SECRET-ACCESS-TOKEN-SHOULD-NOT-IMPORT",
      externalAthleteId: "athlete-1",
    });
    await db.insert(schema.webhookSubscriptions).values({
      userId: SOURCE_USER,
      url: "https://example.invalid/hook",
      encryptedSecret: "SECRET-WEBHOOK-SECRET-SHOULD-NOT-IMPORT",
      events: ["readiness_computed"],
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    // Every user-owned table's userId FK is ON DELETE CASCADE (verified in
    // schema.ts); deleting the two seeded users rows is sufficient cleanup.
    // id-scoped only — never an unscoped delete.
    await db.delete(schema.users).where(eq(schema.users.id, SOURCE_USER));
    await db.delete(schema.users).where(eq(schema.users.id, TARGET_USER));
  });

  it("imports an export for a fresh user in FK order, remapping ids and skipping secret tables", async () => {
    const { db, schema } = await import("@/lib/db");
    const { exportUserData } = await import("./export-user");
    const { importUserData } = await import("./import-user");

    const sample = await exportUserData(db, SOURCE_USER);
    await importUserData(db, TARGET_USER, sample);

    // Basic count fidelity for every plain-userId table.
    const wellness = await db.query.wellnessDaily.findMany({
      where: eq(schema.wellnessDaily.userId, TARGET_USER),
    });
    expect(wellness.length).toBe(sample.wellness_daily.length);
    // Guards against importUserData's explicit wellness_daily column list
    // silently dropping fields (nullable columns don't get caught by
    // TypeScript) — vo2max is one of nine that were previously omitted.
    expect(wellness[0]?.vo2max).toBe(48.2);

    const dailyMetrics = await db.query.dailyMetrics.findMany({
      where: eq(schema.dailyMetrics.userId, TARGET_USER),
    });
    expect(dailyMetrics.length).toBe(sample.daily_metrics.length);

    const memories = await db.query.coachMemories.findMany({
      where: eq(schema.coachMemories.userId, TARGET_USER),
    });
    expect(memories.length).toBe(sample.coach_memories.length);

    // Chain: chat_threads -> activities -> races -> training_plans, all
    // scoped to the target user with fresh ids.
    const threads = await db.query.chatThreads.findMany({
      where: eq(schema.chatThreads.userId, TARGET_USER),
    });
    expect(threads.length).toBe(1);
    expect(threads[0].id).not.toBe(sample.chat_threads[0].id);
    expect(threads[0].title).toBe("IMPORT-TEST-THREAD");

    const messages = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.threadId, threads[0].id),
    });
    expect(messages.length).toBe(2);

    const activities = await db.query.activities.findMany({
      where: eq(schema.activities.userId, TARGET_USER),
    });
    expect(activities.length).toBe(1);
    expect(activities[0].id).not.toBe(sample.activities[0].id);
    // The remapped FK must point at the NEW thread id, not the exported one.
    expect(activities[0].debriefThreadId).toBe(threads[0].id);
    expect(activities[0].debriefThreadId).not.toBe(
      sample.activities[0].debriefThreadId
    );

    // startDateLocal must survive the export/import round-trip distinctly
    // from startDate (true UTC instant) — asserted via local getters, never
    // toISOString()/getTime(), since startDateLocal encodes the athlete's
    // wall-clock time (see src/lib/training-load.test.ts for the pattern).
    expect(sample.activities[0].startDateLocal).not.toBeNull();
    expect(activities[0].startDateLocal).not.toBeNull();
    const importedLocal = activities[0].startDateLocal as Date;
    expect(importedLocal.getFullYear()).toBe(2026);
    expect(importedLocal.getMonth()).toBe(0); // January
    expect(importedLocal.getDate()).toBe(2);
    expect(importedLocal.getHours()).toBe(14);
    expect(importedLocal.getMinutes()).toBe(30);
    // Distinct wall-clock from startDate, proving it's not just a copy/alias.
    expect(importedLocal.getTime()).not.toBe(activities[0].startDate.getTime());

    const streams = await db.query.activityStreams.findMany({
      where: eq(schema.activityStreams.activityId, activities[0].id),
    });
    expect(streams.length).toBe(1);

    const races = await db.query.races.findMany({
      where: eq(schema.races.userId, TARGET_USER),
    });
    expect(races.length).toBe(2);
    // Row order isn't guaranteed without ORDER BY, so match by name rather
    // than array index.
    const importedRace = races.find((r) => r.name === "IMPORT-TEST-RACE")!;
    const importedRaceOne = races.find(
      (r) => r.name === "IMPORT-TEST-RACE-ONE"
    )!;
    const sampleRace = sample.races.find((r) => r.name === "IMPORT-TEST-RACE")!;
    // Remapped FK must point at the NEW activity id.
    expect(importedRace.resultActivityId).toBe(activities[0].id);
    expect(importedRace.resultActivityId).not.toBe(sampleRace.resultActivityId);

    const plans = await db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, TARGET_USER),
    });
    expect(plans.length).toBe(1);
    // Remapped FK must point at the NEW race id.
    expect(plans[0].raceId).toBe(importedRace.id);
    expect(plans[0].raceId).not.toBe(sample.training_plans[0].raceId);

    // The second A-race must survive the round-trip too: firstRaceId
    // remapped to the NEW race id (not the exported one), and the
    // denormalized firstRaceDate/firstRaceType carried through unchanged.
    expect(sample.training_plans[0].firstRaceId).not.toBeNull();
    expect(plans[0].firstRaceId).toBe(importedRaceOne.id);
    expect(plans[0].firstRaceId).not.toBe(sample.training_plans[0].firstRaceId);
    expect(plans[0].firstRaceDate).toBe("2026-03-01");
    expect(plans[0].firstRaceType).toBe("5k");

    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, plans[0].id),
    });
    expect(blocks.length).toBe(1);

    const weekPlans = await db.query.weekPlans.findMany({
      where: eq(schema.weekPlans.userId, TARGET_USER),
    });
    expect(weekPlans.length).toBe(1);
    expect(weekPlans[0].planId).toBe(plans[0].id);

    const adjustments = await db.query.planAdjustments.findMany({
      where: eq(schema.planAdjustments.weekPlanId, weekPlans[0].id),
    });
    expect(adjustments.length).toBe(1);

    // Secret-bearing tables: NEVER imported, even though the export
    // (metadata-only) had rows for the source user.
    expect(sample.api_tokens.length).toBeGreaterThanOrEqual(1);
    expect(sample.connections.length).toBeGreaterThanOrEqual(1);
    expect(sample.webhook_subscriptions.length).toBeGreaterThanOrEqual(1);

    const importedTokens = await db.query.apiTokens.findMany({
      where: eq(schema.apiTokens.userId, TARGET_USER),
    });
    expect(importedTokens.length).toBe(0);

    const importedConnections = await db.query.connections.findMany({
      where: eq(schema.connections.userId, TARGET_USER),
    });
    expect(importedConnections.length).toBe(0);

    const importedWebhooks = await db.query.webhookSubscriptions.findMany({
      where: eq(schema.webhookSubscriptions.userId, TARGET_USER),
    });
    expect(importedWebhooks.length).toBe(0);

    // llm_settings imports normally (nullable secret column), but without
    // the API key.
    const llmSettings = await db.query.llmSettings.findMany({
      where: eq(schema.llmSettings.userId, TARGET_USER),
    });
    expect(llmSettings.length).toBe(1);
    expect(llmSettings[0].encryptedApiKey).toBeNull();
    expect(llmSettings[0].coachLanguage).toBe("nl");

    const surfaceViews = await db.query.surfaceViews.findMany({
      where: eq(schema.surfaceViews.userId, TARGET_USER),
    });
    expect(surfaceViews.length).toBe(sample.surface_views.length);
    expect(surfaceViews[0]?.surface).toBe("train");
    expect(surfaceViews[0]?.count).toBe(5);

    // No row anywhere carries the source user's id.
    expect(activities.every((a) => a.userId === TARGET_USER)).toBe(true);
    expect(races.every((r) => r.userId === TARGET_USER)).toBe(true);
  });

  it("rejects an export with a mismatched version", async () => {
    const { db } = await import("@/lib/db");
    const { exportUserData } = await import("./export-user");
    const { importUserData } = await import("./import-user");

    const sample = await exportUserData(db, SOURCE_USER);
    await expect(
      importUserData(db, TARGET_USER, { ...sample, version: 999 })
    ).rejects.toThrow(/unsupported export version/);
  });

  it("carries every wellness_daily and races column through a round trip", async () => {
    const { db, schema } = await import("@/lib/db");
    const { exportUserData } = await import("./export-user");
    const { importUserData } = await import("./import-user");

    await db.insert(schema.wellnessDaily).values({
      userId: SOURCE_USER,
      date: "2026-01-15",
      sleepingHr: 48.5,
      hrvSdnnMs: 71.2,
      readiness: 82.0,
      hydrationL: 2.4,
      steps: 11302,
      sleepQuality: 3,
    });
    await db.insert(schema.races).values({
      userId: SOURCE_USER,
      name: "Round Trip Classic",
      raceType: "gran_fondo",
      // Deliberately a provider word, not a plan sport: this fixture
      // predates the v0.42 closed-set migration and its round trip through
      // exportUserData -> JSON -> importUserData below is what exercises
      // import-user.ts's toPlanSport/inferPlanSport fallback (canonicalises
      // to "Bike"). The cast is only to satisfy the column's now-strict
      // TS type — races.sport has no DB-level CHECK, so the raw insert
      // still succeeds.
      sport: "Ride" as unknown as "Bike" | "Run" | "Triathlon",
      date: "2026-06-01",
      // `priority` is NOT NULL with no default — omitting it fails the
      // insert on a constraint violation rather than on an assertion.
      priority: "A",
      eventDays: 3,
      distanceKm: 212.5,
      elevationM: 3400,
      demandHoursOverride: 14.5,
    });

    // chat_messages.readAt is the one nullable *timestamp* column among the
    // 11 this round-trip test covers — every other new column is a plain
    // scalar. importUserData routes it through toDateOrNull (see that
    // file's header comment) specifically because a real import's payload
    // comes from req.json(), where a Date has already become an ISO
    // string. beforeAll's own chat_threads/chat_messages fixture never sets
    // readAt (both seeded messages are unread, i.e. null), so a distinct,
    // non-null thread+message pair is seeded here to actually exercise the
    // toDateOrNull(string) path end to end.
    const READ_AT_ISO = "2026-01-15T09:30:00.000Z";
    const [readAtThread] = await db
      .insert(schema.chatThreads)
      .values({ userId: SOURCE_USER, title: "ROUND-TRIP-READAT-THREAD" })
      .returning();
    await db.insert(schema.chatMessages).values({
      threadId: readAtThread.id,
      role: "assistant",
      content: "ROUND-TRIP-READAT-MESSAGE",
      readAt: new Date(READ_AT_ISO),
    });

    // A real import receives its payload from req.json(), which turns every
    // Date into an ISO string. Round-tripping through JSON here exercises
    // the same path rather than the friendlier in-memory shape.
    const fullExport = JSON.parse(
      JSON.stringify(await exportUserData(db, SOURCE_USER))
    );
    // SOURCE_USER already carries the beforeAll fixture's own wellness_daily
    // row (2026-01-02) and race ("IMPORT-TEST-RACE"), and the earlier test
    // in this file has already imported those into TARGET_USER. Importing
    // the full export a second time would re-insert that same fixture data
    // into TARGET_USER — a duplicate-key violation on wellness_daily's
    // (user_id, date) constraint and on every userId-unique singleton table
    // (body_prefs, notification_prefs, journal_prefs, llm_settings), not a
    // hypothetical: reproduced via `npx vitest run
    // src/lib/export/import-user.test.ts` (whole file). Trimming the export
    // to just this test's own two new rows keeps this test using the real
    // exportUserData/importUserData path and the JSON round trip, while
    // staying independent of whether the earlier test ran first.
    const exported = {
      ...fullExport,
      wellness_daily: fullExport.wellness_daily.filter(
        (w: { date: string }) => w.date === "2026-01-15"
      ),
      races: fullExport.races.filter(
        (r: { name: string }) => r.name === "Round Trip Classic"
      ),
      daily_metrics: [],
      // Trimmed to just this test's own thread/message (same reasoning as
      // wellness_daily/races above): importUserData remaps chat_messages'
      // threadId through an old->new id map built while inserting
      // chat_threads, so the thread row must ride along or the message
      // insert throws "references unknown thread" by design.
      chat_threads: fullExport.chat_threads.filter(
        (t: { title: string | null }) => t.title === "ROUND-TRIP-READAT-THREAD"
      ),
      chat_messages: fullExport.chat_messages.filter(
        (m: { content: string }) => m.content === "ROUND-TRIP-READAT-MESSAGE"
      ),
      coach_memories: [],
      biomarkers: [],
      body_prefs: [],
      notification_prefs: [],
      journal_prefs: [],
      surface_views: [],
      llm_settings: [],
      training_plans: [],
      training_blocks: [],
      week_plans: [],
      plan_adjustments: [],
      activities: [],
      activity_streams: [],
      api_tokens: [],
      connections: [],
      webhook_subscriptions: [],
      llm_usage: [],
    };
    await importUserData(db, TARGET_USER, exported);

    // Filtered on date, not just userId: TARGET_USER may already carry the
    // fixture's own wellness_daily/races rows from the earlier test in this
    // file (imported before this test's trimmed, single-row import runs),
    // so a bare userId match would be ambiguous about which row comes back.
    const [wellness] = await db
      .select()
      .from(schema.wellnessDaily)
      .where(
        and(
          eq(schema.wellnessDaily.userId, TARGET_USER),
          eq(schema.wellnessDaily.date, "2026-01-15")
        )
      );
    expect(wellness.sleepingHr).toBeCloseTo(48.5);
    expect(wellness.hrvSdnnMs).toBeCloseTo(71.2);
    expect(wellness.readiness).toBeCloseTo(82.0);
    expect(wellness.hydrationL).toBeCloseTo(2.4);
    expect(wellness.steps).toBe(11302);
    expect(wellness.sleepQuality).toBe(3);

    const [race] = await db
      .select()
      .from(schema.races)
      .where(
        and(
          eq(schema.races.userId, TARGET_USER),
          eq(schema.races.name, "Round Trip Classic")
        )
      );
    expect(race.eventDays).toBe(3);
    expect(race.distanceKm).toBeCloseTo(212.5);
    expect(race.elevationM).toBe(3400);
    expect(race.demandHoursOverride).toBeCloseTo(14.5);

    // Filtered on content, not just threadId/userId: TARGET_USER may already
    // carry the beforeAll fixture's own chat_messages rows (imported by the
    // earlier test in this file), so a bare "messages in this thread" query
    // would still be unambiguous here (fresh thread), but matching by
    // content keeps this assertion self-contained and obviously correct.
    const [importedThread] = await db
      .select()
      .from(schema.chatThreads)
      .where(
        and(
          eq(schema.chatThreads.userId, TARGET_USER),
          eq(schema.chatThreads.title, "ROUND-TRIP-READAT-THREAD")
        )
      );
    const [importedMessage] = await db
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.threadId, importedThread.id),
          eq(schema.chatMessages.content, "ROUND-TRIP-READAT-MESSAGE")
        )
      );
    // Compare via new Date(...).toISOString() rather than direct equality:
    // robust to whether the driver hands back a Date or (as in a real
    // req.json()-sourced import) an ISO string survived unconverted — the
    // whole point of this assertion is proving the toDateOrNull(string)
    // path in import-user.ts actually ran and produced the right instant.
    expect(importedMessage.readAt).not.toBeNull();
    expect(new Date(importedMessage.readAt as Date).toISOString()).toBe(
      READ_AT_ISO
    );
  });

  // Both tests below build a hand-fabricated race row from a real exported
  // one rather than inserting through `db`: `races.sport` is NOT NULL in
  // the live schema, so a genuine pre-v0.42 export (no `sport` column at
  // all) can only be simulated as a plain JS/JSON object, exactly like a
  // real legacy export file would look once parsed off disk.
  it("a pre-v0.42 row (sport null, raceType unrecognised, no matching plan) throws naming the race, not a silent Run", async () => {
    const { db, schema } = await import("@/lib/db");
    const { exportUserData } = await import("./export-user");
    const { importUserData } = await import("./import-user");

    const fullExport = JSON.parse(
      JSON.stringify(await exportUserData(db, SOURCE_USER))
    );
    // Not fullExport.races[0]: exportUserData has no ORDER BY on races, and
    // by this point in the file SOURCE_USER carries more than one race
    // fixture — find() rather than index into an unspecified order.
    const templateRace = fullExport.races.find(
      (r: { name: string }) => r.name === "IMPORT-TEST-RACE"
    );
    const legacyRace = {
      ...templateRace,
      id: "legacy-race-null-sport-no-plan",
      name: "Bikepacking Epic",
      raceType: "gravel_epic", // not in RACE_TYPE_SPORT
      sport: null, // simulates an export taken before the column existed
      resultActivityId: null,
    };
    const exported = {
      ...fullExport,
      races: [legacyRace],
      wellness_daily: [],
      daily_metrics: [],
      chat_threads: [],
      chat_messages: [],
      coach_memories: [],
      biomarkers: [],
      body_prefs: [],
      notification_prefs: [],
      journal_prefs: [],
      surface_views: [],
      llm_settings: [],
      training_plans: [],
      training_blocks: [],
      week_plans: [],
      plan_adjustments: [],
      activities: [],
      activity_streams: [],
      api_tokens: [],
      connections: [],
      webhook_subscriptions: [],
      llm_usage: [],
    };

    // Every fallback misses (sport null, raceType and name both
    // unrecognised, no plan targets this race) — this must throw, naming
    // the offending row, rather than defaulting to "Run" the way a fourth
    // silent fallback would.
    await expect(importUserData(db, TARGET_USER, exported)).rejects.toThrow(
      /legacy-race-null-sport-no-plan/
    );
    await expect(importUserData(db, TARGET_USER, exported)).rejects.toThrow(
      /gravel_epic/
    );

    // And the throw actually rolled back — nothing from this row landed.
    const stray = await db.query.races.findFirst({
      where: and(
        eq(schema.races.userId, TARGET_USER),
        eq(schema.races.name, "Bikepacking Epic")
      ),
    });
    expect(stray).toBeUndefined();
  });

  it("a pre-v0.42 row falls back to the plan that targets it when sport, raceType and name all miss", async () => {
    const { db, schema } = await import("@/lib/db");
    const { exportUserData } = await import("./export-user");
    const { importUserData } = await import("./import-user");

    const fullExport = JSON.parse(
      JSON.stringify(await exportUserData(db, SOURCE_USER))
    );
    const templateRace = fullExport.races.find(
      (r: { name: string }) => r.name === "IMPORT-TEST-RACE"
    );
    const legacyRace = {
      ...templateRace,
      id: "legacy-race-with-plan",
      name: "Bikepacking Epic",
      raceType: "gravel_epic",
      sport: null,
      resultActivityId: null,
    };
    // SOURCE_USER's only training_plans row (beforeAll's IMPORT-TEST-PLAN),
    // so [0] is unambiguous here, unlike races above.
    const legacyPlan = {
      ...fullExport.training_plans[0],
      id: "legacy-plan-for-bikepacking-epic",
      raceId: "legacy-race-with-plan",
      // Pre-v0.42 shape: every discipline the plan touches, not one
      // PlanSport — this exercises sportFromPlanConstraints' "more than
      // one value can only mean Triathlon" branch.
      constraints: {
        daysPerWeek: 6,
        hoursPerWeek: 12,
        sports: ["Swim", "Bike", "Run"],
      },
    };
    const exported = {
      ...fullExport,
      races: [legacyRace],
      training_plans: [legacyPlan],
      wellness_daily: [],
      daily_metrics: [],
      chat_threads: [],
      chat_messages: [],
      coach_memories: [],
      biomarkers: [],
      body_prefs: [],
      notification_prefs: [],
      journal_prefs: [],
      surface_views: [],
      llm_settings: [],
      training_blocks: [],
      week_plans: [],
      plan_adjustments: [],
      activities: [],
      activity_streams: [],
      api_tokens: [],
      connections: [],
      webhook_subscriptions: [],
      llm_usage: [],
    };

    await importUserData(db, TARGET_USER, exported);

    const [race] = await db
      .select()
      .from(schema.races)
      .where(
        and(
          eq(schema.races.userId, TARGET_USER),
          eq(schema.races.name, "Bikepacking Epic")
        )
      );
    expect(race.sport).toBe("Triathlon");
  });
});

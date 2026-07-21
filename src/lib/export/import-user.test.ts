import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

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
    await db.insert(schema.llmSettings).values({
      userId: SOURCE_USER,
      providerType: "anthropic",
      model: "claude-sonnet",
      encryptedApiKey: "SECRET-SHOULD-NOT-IMPORT",
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
        date: "2026-06-01",
        priority: "A",
        status: "completed",
        resultActivityId: activity.id,
      })
      .returning();

    // Training plan links back to the race (raceId) — proves training_plans
    // is inserted after races with correct remap.
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

    const streams = await db.query.activityStreams.findMany({
      where: eq(schema.activityStreams.activityId, activities[0].id),
    });
    expect(streams.length).toBe(1);

    const races = await db.query.races.findMany({
      where: eq(schema.races.userId, TARGET_USER),
    });
    expect(races.length).toBe(1);
    // Remapped FK must point at the NEW activity id.
    expect(races[0].resultActivityId).toBe(activities[0].id);
    expect(races[0].resultActivityId).not.toBe(
      sample.races[0].resultActivityId
    );

    const plans = await db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, TARGET_USER),
    });
    expect(plans.length).toBe(1);
    // Remapped FK must point at the NEW race id.
    expect(plans[0].raceId).toBe(races[0].id);
    expect(plans[0].raceId).not.toBe(sample.training_plans[0].raceId);

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
});

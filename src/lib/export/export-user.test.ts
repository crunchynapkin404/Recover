import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// Matches the rest of the suite (e.g. sync-jobs.test.ts, audit.test.ts): no
// separate test DB, so every row here is test-* scoped and cleaned up via
// FK cascade off the seeded users row.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-export-user";
const OTHER_USER = "test-export-other-user"; // proves queries are userId-scoped, not global

// Distinct, greppable markers for each secret-bearing field. If any of
// these substrings ever show up in the exported JSON, a real credential
// (or its ciphertext) has leaked.
const SECRET_ACCESS_TOKEN = "SECRET-MARKER-ACCESS-TOKEN-4f9a";
const SECRET_REFRESH_TOKEN = "SECRET-MARKER-REFRESH-TOKEN-2b7c";
const SECRET_API_KEY = "SECRET-MARKER-LLM-API-KEY-91de";
const SECRET_TOKEN_HASH = "SECRET-MARKER-TOKEN-HASH-c03f";
const SECRET_WEBHOOK_SECRET = "SECRET-MARKER-WEBHOOK-SECRET-77aa";

describe.skipIf(!hasDb)("exportUserData", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");

    await db
      .insert(schema.users)
      .values([
        { id: USER, name: "Export Test User", email: "export-test@example.invalid" },
        { id: OTHER_USER, name: "Other User", email: "export-other@example.invalid" },
      ])
      .onConflictDoNothing();

    // Decoy row for a different user — must never appear in USER's export.
    await db.insert(schema.wellnessDaily).values({
      userId: OTHER_USER,
      date: "2026-01-01",
      hrvMs: 999,
    });

    await db.insert(schema.wellnessDaily).values({
      userId: USER,
      date: "2026-01-02",
      hrvMs: 55,
      notes: "felt good",
    });

    await db.insert(schema.activities).values({
      userId: USER,
      provider: "manual",
      externalId: "ext-1",
      startDate: new Date("2026-01-02T08:00:00Z"),
      sport: "Ride",
      raw: { some: "provider-blob", shouldNotAppear: "raw-marker-xyz" },
    });

    await db.insert(schema.dailyMetrics).values({
      userId: USER,
      date: "2026-01-02",
      readiness: 72,
      band: "green",
    });

    const [thread] = await db
      .insert(schema.chatThreads)
      .values({ userId: USER, title: "Test thread" })
      .returning();
    await db.insert(schema.chatMessages).values([
      { threadId: thread.id, role: "user", content: "hello" },
      { threadId: thread.id, role: "assistant", content: "hi there" },
    ]);

    await db.insert(schema.coachMemories).values({
      userId: USER,
      category: "goal",
      content: "sub-3 marathon",
    });

    await db.insert(schema.biomarkers).values({
      userId: USER,
      name: "ldl_cholesterol",
      displayName: "LDL Cholesterol",
      value: 95,
      measuredAt: "2026-01-01",
      source: "manual",
    });

    await db.insert(schema.bodyPrefs).values({ userId: USER, maxHr: 190 });
    await db.insert(schema.notificationPrefs).values({ userId: USER });
    await db
      .insert(schema.journalPrefs)
      .values({ userId: USER, usualBehaviorTags: ["caffeine"] });

    await db.insert(schema.llmSettings).values({
      userId: USER,
      providerType: "anthropic",
      model: "claude-sonnet",
      encryptedApiKey: SECRET_API_KEY,
    });

    await db.insert(schema.races).values({
      userId: USER,
      name: "Test 10k",
      raceType: "10k",
      date: "2026-06-01",
      priority: "A",
    });

    const [plan] = await db
      .insert(schema.trainingPlans)
      .values({
        userId: USER,
        title: "Test plan",
        raceType: "10k",
        raceDate: "2026-06-01",
        startDate: "2026-01-01",
        weeksTotal: 12,
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
        userId: USER,
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

    await db.insert(schema.apiTokens).values({
      userId: USER,
      tokenHash: SECRET_TOKEN_HASH,
      lookupPrefix: "abcd1234",
      label: "My token",
    });

    await db.insert(schema.connections).values({
      userId: USER,
      provider: "strava",
      encryptedAccessToken: SECRET_ACCESS_TOKEN,
      encryptedRefreshToken: SECRET_REFRESH_TOKEN,
      externalAthleteId: "athlete-1",
    });

    await db.insert(schema.webhookSubscriptions).values({
      userId: USER,
      url: "https://example.invalid/hook",
      encryptedSecret: SECRET_WEBHOOK_SECRET,
      events: ["readiness_computed"],
    });

    await db.insert(schema.llmUsage).values({
      userId: USER,
      model: "claude-sonnet",
      slot: "deep",
      purpose: "chat",
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    // Every user-owned table's userId FK is ON DELETE CASCADE (verified in
    // schema.ts), and cascades chain transitively (chat_threads ->
    // chat_messages, training_plans -> training_blocks, week_plans ->
    // plan_adjustments, etc.) — deleting the two seeded users rows is
    // sufficient cleanup.
    await db.delete(schema.users).where(eq(schema.users.id, USER));
    await db.delete(schema.users).where(eq(schema.users.id, OTHER_USER));
  });

  it("covers every user-owned table, scopes to the requested user, and strips secrets", async () => {
    const { db } = await import("@/lib/db");
    const { exportUserData } = await import("./export-user");

    const out = await exportUserData(db, USER);

    // Completeness: every table named in the task brief plus the
    // journalPrefs/webhookSubscriptions/llmUsage tables this task adds.
    const tables = Object.keys(out);
    expect(tables).toEqual(
      expect.arrayContaining([
        "wellness_daily",
        "activities",
        "daily_metrics",
        "chat_threads",
        "chat_messages",
        "coach_memories",
        "biomarkers",
        "body_prefs",
        "notification_prefs",
        "journal_prefs",
        "llm_settings",
        "races",
        "training_plans",
        "training_blocks",
        "week_plans",
        "plan_adjustments",
        "api_tokens",
        "connections",
        "webhook_subscriptions",
        "llm_usage",
      ])
    );
    expect(out.version).toBeDefined();
    expect(out.exported_at).toBeDefined();

    // Non-vacuous: joined/child tables actually returned the seeded rows,
    // proving the join predicate works, not just that the key exists.
    expect(out.wellness_daily.length).toBeGreaterThanOrEqual(1);
    expect(out.activities.length).toBeGreaterThanOrEqual(1);
    expect(out.chat_messages.length).toBeGreaterThanOrEqual(2);
    expect(out.training_blocks.length).toBeGreaterThanOrEqual(1);
    expect(out.plan_adjustments.length).toBeGreaterThanOrEqual(1);
    expect(out.connections.length).toBeGreaterThanOrEqual(1);
    expect(out.api_tokens.length).toBeGreaterThanOrEqual(1);
    expect(out.llm_settings.length).toBeGreaterThanOrEqual(1);
    expect(out.webhook_subscriptions.length).toBeGreaterThanOrEqual(1);
    expect(out.llm_usage.length).toBeGreaterThanOrEqual(1);
    expect(out.journal_prefs.length).toBeGreaterThanOrEqual(1);

    // Scoping: the other user's decoy row must never appear.
    expect(
      out.wellness_daily.every((w: { userId: string }) => w.userId === USER)
    ).toBe(true);

    // Structural secret-stripping: the fields must not exist at all, not
    // merely be blanked.
    expect(out.connections[0]).not.toHaveProperty("encryptedAccessToken");
    expect(out.connections[0]).not.toHaveProperty("encryptedRefreshToken");
    expect(out.api_tokens[0]).not.toHaveProperty("tokenHash");
    expect(out.llm_settings[0]).not.toHaveProperty("encryptedApiKey");
    expect(out.webhook_subscriptions[0]).not.toHaveProperty(
      "encryptedSecret"
    );
    expect(out.activities[0]).not.toHaveProperty("raw");

    // No decrypted/encrypted secret value ever leaves as a substring
    // anywhere in the export, under any field name.
    const json = JSON.stringify(out);
    expect(json).not.toContain(SECRET_ACCESS_TOKEN);
    expect(json).not.toContain(SECRET_REFRESH_TOKEN);
    expect(json).not.toContain(SECRET_API_KEY);
    expect(json).not.toContain(SECRET_TOKEN_HASH);
    expect(json).not.toContain(SECRET_WEBHOOK_SECRET);
    expect(json).not.toContain("raw-marker-xyz");
  });
});

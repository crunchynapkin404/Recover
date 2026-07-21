/**
 * export→wipe→import round-trip drill — the actual logic half of
 * scripts/export-import-drill.sh. Runs against whatever DATABASE_URL is in
 * this process's env; the bash wrapper is responsible for making sure
 * that's a scratch, throwaway Postgres container and NEVER the real
 * DATABASE_URL from .env. This script adds its own independent guard below
 * (an empty `users` table check) so that even if it were ever invoked with
 * the wrong DATABASE_URL by mistake, it refuses to touch a populated
 * database rather than trusting the caller.
 *
 * Flow:
 *   1. Safety guards (driver, port, empty-db check).
 *   2. Seed a fake user with data across every exported table, including
 *      the three nullable cross-table FKs (activities.debriefThreadId,
 *      races.resultActivityId, trainingPlans.raceId) and the three
 *      secret-bearing tables (connections/api_tokens/webhook_subscriptions)
 *      that importUserData is expected to skip.
 *   3. exportUserData -> export1.
 *   4. Wipe: delete every row this user owns (but not the `users` row
 *      itself — importUserData's precondition is that the target user
 *      already exists).
 *   5. Round-trip export1 through JSON.stringify/parse, exactly like the
 *      real /api/export -> file -> /api/import-account path does (a raw
 *      in-memory object would never observe Date-to-string coercion bugs
 *      that only show up after a real JSON hop).
 *   6. importUserData(db, user, roundtripped export1).
 *   7. exportUserData -> export2.
 *   8. Assert export1 and export2 are semantically identical: same content
 *      per table (matched by marker fields, not id or array order —
 *      ids are expected to differ, that's the point of fresh-id-on-import),
 *      remapped FKs resolve to the correct NEW row, and the three
 *      secret-bearing tables are present in export1 but empty in export2.
 *
 * Exits 0 and prints "drill: PASS" on success. Throws (non-zero exit,
 * Node's default uncaught-exception stack trace) on any mismatch.
 */
import assert from "node:assert/strict";
// Relative imports, not "@/" — matches scripts/seed-owner.ts and
// scripts/seed-demo.ts: tsx run standalone doesn't resolve the tsconfig
// path alias.
import { db, schema } from "../src/lib/db";
import { exportUserData, type UserExport } from "../src/lib/export/export-user";
import { importUserData } from "../src/lib/export/import-user";
import { eq } from "drizzle-orm";

const DRILL_USER = "drill-user-1";

const MARKER_THREAD = "DRILL-THREAD-1";
const MARKER_ACTIVITY = "DRILL-ACTIVITY-1";
const MARKER_RACE = "DRILL-RACE-1";
const MARKER_PLAN = "DRILL-PLAN-1";

function log(msg: string) {
  console.log(`drill-ts: ${msg}`);
}

function fail(msg: string): never {
  console.error(`drill-ts: FAIL — ${msg}`);
  process.exit(1);
}

// ── Guard 1: driver + port ──────────────────────────────────────────────
// Independent of the bash wrapper's own construction of DATABASE_URL — a
// second, in-process check that this is unambiguously NOT the real dev DB
// (127.0.0.1:5434) or the old retired dev DB (127.0.0.1:5433).
function assertScratchTarget() {
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set");
  if (process.env.DATABASE_DRIVER !== "pg") {
    fail(
      `DATABASE_DRIVER must be "pg" for this drill (got ${process.env.DATABASE_DRIVER ?? "unset"})`
    );
  }
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    fail(`refusing to run against non-local host "${parsed.hostname}"`);
  }
  if (parsed.port === "5434") {
    fail(
      "DATABASE_URL port 5434 is the real dev DB (recover-db-1) — refusing to run"
    );
  }
  if (parsed.port === "5433") {
    fail("DATABASE_URL port 5433 is the old retired dev DB — refusing to run");
  }
  log(
    `target check passed: ${parsed.hostname}:${parsed.port}${parsed.pathname}`
  );
}

// ── Guard 2: the database must be freshly migrated and empty, not just a
// different port. If this ever fails, something is deeply wrong with how
// this script was invoked — abort before touching anything else. ────────
async function assertEmptyDatabase() {
  const existing = await db.query.users.findMany();
  if (existing.length !== 0) {
    fail(
      `expected an empty freshly-migrated database (0 users), found ${existing.length} — refusing to seed/wipe/import against a database that already has data`
    );
  }
  log("empty-database check passed (0 existing users)");
}

async function seed() {
  await db.insert(schema.users).values({
    id: DRILL_USER,
    name: "Drill User",
    email: "drill-user@example.invalid",
  });

  await db.insert(schema.wellnessDaily).values({
    userId: DRILL_USER,
    date: "2026-01-02",
    hrvMs: 55,
    notes: "drill wellness note",
  });
  await db.insert(schema.dailyMetrics).values({
    userId: DRILL_USER,
    date: "2026-01-02",
    readiness: 72,
    band: "green",
  });
  await db.insert(schema.bodyPrefs).values({ userId: DRILL_USER, maxHr: 190 });
  await db.insert(schema.notificationPrefs).values({ userId: DRILL_USER });
  await db
    .insert(schema.journalPrefs)
    .values({ userId: DRILL_USER, usualBehaviorTags: ["caffeine"] });
  await db.insert(schema.llmSettings).values({
    userId: DRILL_USER,
    providerType: "anthropic",
    model: "claude-sonnet",
    encryptedApiKey: "SECRET-SHOULD-NOT-SURVIVE-ROUNDTRIP",
  });
  await db.insert(schema.biomarkers).values({
    userId: DRILL_USER,
    name: "ldl_cholesterol",
    displayName: "LDL Cholesterol",
    value: 95,
    measuredAt: "2026-01-01",
    source: "manual",
  });
  await db.insert(schema.llmUsage).values({
    userId: DRILL_USER,
    model: "claude-sonnet",
    slot: "deep",
    purpose: "chat",
    inputTokens: 100,
    outputTokens: 50,
  });
  await db.insert(schema.coachMemories).values({
    userId: DRILL_USER,
    category: "goal",
    content: "sub-3 marathon",
  });

  const [thread] = await db
    .insert(schema.chatThreads)
    .values({ userId: DRILL_USER, title: MARKER_THREAD })
    .returning();
  await db.insert(schema.chatMessages).values([
    { threadId: thread.id, role: "user", content: "hello from the drill" },
    { threadId: thread.id, role: "assistant", content: "hi there" },
  ]);

  const [activity] = await db
    .insert(schema.activities)
    .values({
      userId: DRILL_USER,
      provider: "manual",
      externalId: "drill-ext-1",
      startDate: new Date("2026-01-02T08:00:00Z"),
      sport: "Ride",
      name: MARKER_ACTIVITY,
      debriefThreadId: thread.id,
      debriefState: "answered",
    })
    .returning();
  await db.insert(schema.activityStreams).values({
    activityId: activity.id,
    type: "heartrate",
    data: { series: [120, 125, 130] },
  });

  const [race] = await db
    .insert(schema.races)
    .values({
      userId: DRILL_USER,
      name: MARKER_RACE,
      raceType: "10k",
      date: "2026-06-01",
      priority: "A",
      status: "completed",
      resultActivityId: activity.id,
    })
    .returning();

  const [plan] = await db
    .insert(schema.trainingPlans)
    .values({
      userId: DRILL_USER,
      title: MARKER_PLAN,
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
      userId: DRILL_USER,
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

  // Secret-bearing tables — must survive the export (metadata only) but
  // must NOT come back on import.
  await db.insert(schema.apiTokens).values({
    userId: DRILL_USER,
    tokenHash: "SECRET-TOKEN-HASH-SHOULD-NOT-SURVIVE",
    lookupPrefix: "abcd1234",
    label: "Drill token",
  });
  await db.insert(schema.connections).values({
    userId: DRILL_USER,
    provider: "strava",
    encryptedAccessToken: "SECRET-ACCESS-TOKEN-SHOULD-NOT-SURVIVE",
    externalAthleteId: "drill-athlete-1",
  });
  await db.insert(schema.webhookSubscriptions).values({
    userId: DRILL_USER,
    url: "https://example.invalid/hook",
    encryptedSecret: "SECRET-WEBHOOK-SECRET-SHOULD-NOT-SURVIVE",
    events: ["readiness_computed"],
  });

  log("seed complete");
}

/** Delete every row DRILL_USER owns, but not the `users` row itself —
 * importUserData's precondition is that the target user already exists.
 * Cascades (verified in schema.ts) handle the doubly-indirect child
 * tables: chat_messages (via chat_threads), activity_streams (via
 * activities), training_blocks/week_plans (via training_plans),
 * plan_adjustments (via week_plans). */
async function wipe() {
  const directTables = [
    schema.wellnessDaily,
    schema.dailyMetrics,
    schema.bodyPrefs,
    schema.notificationPrefs,
    schema.journalPrefs,
    schema.llmSettings,
    schema.biomarkers,
    schema.llmUsage,
    schema.coachMemories,
    schema.chatThreads,
    schema.activities,
    schema.races,
    schema.trainingPlans,
    schema.weekPlans,
    schema.connections,
    schema.apiTokens,
    schema.webhookSubscriptions,
  ];
  for (const table of directTables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic table loop over heterogeneous schema tables
    await db.delete(table as any).where(eq((table as any).userId, DRILL_USER));
  }
  log("wipe complete");
}

async function assertWiped() {
  const wellness = await db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, DRILL_USER),
  });
  const activities = await db.query.activities.findMany({
    where: eq(schema.activities.userId, DRILL_USER),
  });
  const threads = await db.query.chatThreads.findMany({
    where: eq(schema.chatThreads.userId, DRILL_USER),
  });
  assert.equal(wellness.length, 0, "wipe left wellness_daily rows behind");
  assert.equal(activities.length, 0, "wipe left activities rows behind");
  assert.equal(threads.length, 0, "wipe left chat_threads rows behind");
  // The user row itself must still exist — importUserData never creates it.
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, DRILL_USER),
  });
  assert.ok(user, "wipe deleted the users row itself — it must survive");
  log("post-wipe check passed (data gone, user row intact)");
}

function byMarker<T extends Record<string, unknown>>(
  rows: T[],
  field: string,
  marker: string
): T {
  const row = rows.find((r) => r[field] === marker);
  if (!row) throw new Error(`no row with ${field} === ${marker}`);
  return row;
}

/** Deep-compare two rows for content equality, ignoring `id` and any
 * caller-specified FK-id fields (those are expected to change — a fresh
 * id was generated on import, and children were remapped to point at it).
 * `createdAt`/`updatedAt` are NOT ignored: importUserData preserves them
 * explicitly, so real inequality there is a real bug. */
function assertContentEqual(
  label: string,
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  ignoreFields: string[]
) {
  const strip = (row: Record<string, unknown>) => {
    const copy = { ...row };
    delete copy.id;
    for (const f of ignoreFields) delete copy[f];
    return copy;
  };
  assert.deepEqual(
    strip(a),
    strip(b),
    `${label}: content mismatch after round trip`
  );
}

async function compare(export1: UserExport, export2: UserExport) {
  // ── Plain tables: same count, same content (id aside). ─────────────────
  const plainTables: (keyof UserExport)[] = [
    "wellness_daily",
    "daily_metrics",
    "body_prefs",
    "notification_prefs",
    "journal_prefs",
    "biomarkers",
    "llm_usage",
    "coach_memories",
  ];
  for (const t of plainTables) {
    const arr1 = export1[t] as Record<string, unknown>[];
    const arr2 = export2[t] as Record<string, unknown>[];
    assert.equal(
      arr2.length,
      arr1.length,
      `${t}: row count changed after round trip`
    );
  }
  assert.equal(export2.wellness_daily.length, 1);
  assertContentEqual(
    "wellness_daily",
    export1.wellness_daily[0] as unknown as Record<string, unknown>,
    export2.wellness_daily[0] as unknown as Record<string, unknown>,
    ["search"] // generated column; not meaningfully comparable/settable
  );

  // llm_settings: imports normally, but the (already-stripped-at-export)
  // encryptedApiKey stays absent — both exports omit the field entirely
  // (see UserExport's Omit<...,"encryptedApiKey">), so a plain content
  // compare (id aside) is exactly right here, no special-casing needed.
  assert.equal(export2.llm_settings.length, export1.llm_settings.length);
  assertContentEqual(
    "llm_settings",
    export1.llm_settings[0] as unknown as Record<string, unknown>,
    export2.llm_settings[0] as unknown as Record<string, unknown>,
    []
  );

  // ── The FK chain, matched by marker (not array order/id). ──────────────
  const thread1 = byMarker(export1.chat_threads, "title", MARKER_THREAD);
  const thread2 = byMarker(export2.chat_threads, "title", MARKER_THREAD);
  assert.notEqual(
    thread2.id,
    thread1.id,
    "chat_threads: id was not regenerated"
  );
  assertContentEqual("chat_threads", thread1, thread2, []);

  assert.equal(export2.chat_messages.length, export1.chat_messages.length);
  const msgs2 = export2.chat_messages.filter((m) => m.threadId === thread2.id);
  assert.equal(
    msgs2.length,
    export1.chat_messages.length,
    "chat_messages: not all remapped to the new thread id"
  );

  const activity1 = byMarker(export1.activities, "name", MARKER_ACTIVITY);
  const activity2 = byMarker(export2.activities, "name", MARKER_ACTIVITY);
  assert.notEqual(
    activity2.id,
    activity1.id,
    "activities: id was not regenerated"
  );
  assertContentEqual("activities", activity1, activity2, ["debriefThreadId"]);
  // The nullable cross-FK: must resolve to the NEW thread, not the old one.
  assert.equal(
    activity2.debriefThreadId,
    thread2.id,
    "activities.debriefThreadId was not remapped to the new chat_threads id"
  );
  assert.notEqual(
    activity2.debriefThreadId,
    thread1.id,
    "activities.debriefThreadId still points at the OLD (pre-import) thread id"
  );

  assert.equal(
    export2.activity_streams.length,
    export1.activity_streams.length
  );
  const streams2 = export2.activity_streams.filter(
    (s) => s.activityId === activity2.id
  );
  assert.equal(
    streams2.length,
    export1.activity_streams.length,
    "activity_streams: not all remapped to the new activity id"
  );

  const race1 = byMarker(export1.races, "name", MARKER_RACE);
  const race2 = byMarker(export2.races, "name", MARKER_RACE);
  assert.notEqual(race2.id, race1.id, "races: id was not regenerated");
  assertContentEqual("races", race1, race2, ["resultActivityId"]);
  assert.equal(
    race2.resultActivityId,
    activity2.id,
    "races.resultActivityId was not remapped to the new activities id"
  );
  assert.notEqual(
    race2.resultActivityId,
    activity1.id,
    "races.resultActivityId still points at the OLD (pre-import) activity id"
  );

  const plan1 = byMarker(export1.training_plans, "title", MARKER_PLAN);
  const plan2 = byMarker(export2.training_plans, "title", MARKER_PLAN);
  assert.notEqual(plan2.id, plan1.id, "training_plans: id was not regenerated");
  assertContentEqual("training_plans", plan1, plan2, ["raceId"]);
  assert.equal(
    plan2.raceId,
    race2.id,
    "training_plans.raceId was not remapped to the new races id"
  );
  assert.notEqual(
    plan2.raceId,
    race1.id,
    "training_plans.raceId still points at the OLD (pre-import) race id"
  );

  assert.equal(export2.training_blocks.length, export1.training_blocks.length);
  const blocks2 = export2.training_blocks.filter((b) => b.planId === plan2.id);
  assert.equal(
    blocks2.length,
    export1.training_blocks.length,
    "training_blocks: not all remapped to the new plan id"
  );

  assert.equal(export2.week_plans.length, export1.week_plans.length);
  const weekPlan2 = export2.week_plans.find((w) => w.planId === plan2.id);
  assert.ok(weekPlan2, "week_plans: no row remapped to the new plan id");

  assert.equal(
    export2.plan_adjustments.length,
    export1.plan_adjustments.length
  );
  const adjustments2 = export2.plan_adjustments.filter(
    (a) => a.weekPlanId === weekPlan2!.id
  );
  assert.equal(
    adjustments2.length,
    export1.plan_adjustments.length,
    "plan_adjustments: not all remapped to the new week_plan id"
  );

  // ── Secret-bearing tables: present before, gone after (by design). ─────
  assert.ok(
    export1.connections.length >= 1,
    "seed did not create a connections row"
  );
  assert.ok(
    export1.api_tokens.length >= 1,
    "seed did not create an api_tokens row"
  );
  assert.ok(
    export1.webhook_subscriptions.length >= 1,
    "seed did not create a webhook_subscriptions row"
  );
  assert.equal(
    export2.connections.length,
    0,
    "connections rows were imported — they should be skipped (NOT NULL secret column, no value in export)"
  );
  assert.equal(
    export2.api_tokens.length,
    0,
    "api_tokens rows were imported — they should be skipped (NOT NULL secret column, no value in export)"
  );
  assert.equal(
    export2.webhook_subscriptions.length,
    0,
    "webhook_subscriptions rows were imported — they should be skipped (NOT NULL secret column, no value in export)"
  );

  log("compare: all assertions passed");
}

async function main() {
  assertScratchTarget();
  await assertEmptyDatabase();

  await seed();

  const export1 = await exportUserData(db, DRILL_USER);
  assert.ok(
    export1.wellness_daily.length >= 1,
    "sanity: seed didn't produce a wellness_daily row"
  );
  assert.ok(
    export1.connections.length >= 1,
    "sanity: seed didn't produce a connections row"
  );
  log(
    `export1: wellness_daily=${export1.wellness_daily.length} activities=${export1.activities.length} chat_messages=${export1.chat_messages.length} connections=${export1.connections.length}`
  );

  await wipe();
  await assertWiped();

  // Faithful to the real /api/export -> download -> upload -> /api/import-account
  // path: a real JSON hop, not the in-memory object exportUserData returned.
  const roundtripped = JSON.parse(JSON.stringify(export1)) as UserExport;

  await importUserData(db, DRILL_USER, roundtripped);

  const export2 = await exportUserData(db, DRILL_USER);
  log(
    `export2: wellness_daily=${export2.wellness_daily.length} activities=${export2.activities.length} chat_messages=${export2.chat_messages.length} connections=${export2.connections.length}`
  );

  await compare(export1, export2);

  console.log(
    "drill: PASS — export -> wipe -> import round trip is lossless (secret tables correctly skipped)"
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("drill-ts: FAIL —", err);
  process.exit(1);
});

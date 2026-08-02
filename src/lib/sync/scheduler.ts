import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Arbitrary app-wide advisory lock key for the scheduler tick. */
const TICK_LOCK_KEY = 727_001;
/** A job stuck in "running" longer than this is presumed crashed and reclaimed. */
const STALE_RUNNING_MINUTES = 15;
const MAX_ATTEMPTS = 5;
/** Daily sync hour (server-local). */
const SYNC_HOUR = 5;
/**
 * Server-local hour after which the morning brief fires even with
 * incomplete data, and weekly/monthly review are re-checked. Their own
 * due-since-slot guards only fire once actually due — this is what lets
 * BOTH slots move to this hour without waiting for tomorrow's sync to
 * notice the slot passed (see docs/specs/2026-07-26-event-driven-sync-
 * triggers-design.md).
 */
const BACKSTOP_HOUR = 9;

/**
 * Whether the tick may run its DB-wide provider passes (activity poll,
 * wellness refresh).
 *
 * False under vitest. Those passes query connections across all users and
 * then call provider APIs for real — and this repo's DB-gated tests run
 * against a database holding REAL connection rows, with no separate test
 * database. So any test touching the tick made live intervals.icu requests,
 * and on 2026-08-02 one produced a real LLM ride review (haiku, 3027/233
 * tokens) written into the owner's actual coaching thread.
 *
 * Both passes keep their own direct tests, which scope the query with
 * `userIds` and inject a fetcher; only the tick's unscoped call is
 * suppressed. Kept as one predicate so the two guards cannot drift.
 */
function providerPassesEnabled(): boolean {
  return !process.env.VITEST;
}

type SyncJob = typeof schema.syncJobs.$inferSelect;

export type JobProcessor = (job: SyncJob) => Promise<void>;

async function defaultProcessor(job: SyncJob): Promise<void> {
  if (job.provider === "intervals_icu") {
    const { runIntervalsSync } = await import("@/lib/sync/intervals-sync");
    await runIntervalsSync(job.userId);
    return;
  }
  if (job.provider === "strava") {
    const { runStravaSync } = await import("@/lib/sync/strava-sync");
    await runStravaSync(job.userId);
    return;
  }
  if (job.provider === "whoop") {
    const { runWhoopSync } = await import("@/lib/sync/whoop-sync");
    await runWhoopSync(job.userId);
    return;
  }
  if (job.provider === "oura") {
    const { runOuraSync } = await import("@/lib/sync/oura-sync");
    await runOuraSync(job.userId);
    return;
  }
  if (job.provider === "withings") {
    const { runWithingsSync } = await import("@/lib/sync/withings-sync");
    await runWithingsSync(job.userId);
    return;
  }
  throw new Error(`No processor for provider ${job.provider}`);
}

function nextMorning(): Date {
  const next = new Date();
  next.setHours(SYNC_HOUR, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  // Jitter ±10 min so multiple users never hit provider APIs in the same second.
  next.setMinutes(next.getMinutes() + Math.floor(Math.random() * 20) - 10);
  return next;
}

/** Ensure every active connection has a pending sync job. */
export async function ensureJobsForConnections(): Promise<void> {
  const connections = await db.query.connections.findMany({
    where: eq(schema.connections.status, "active"),
    columns: { userId: true, provider: true },
  });

  for (const c of connections) {
    // google_calendar has no pull pipeline; apple_health is push-only
    // (Health Auto Export webhook / file upload) — neither uses sync_jobs.
    if (c.provider === "google_calendar" || c.provider === "apple_health")
      continue;

    const existing = await db.query.syncJobs.findFirst({
      where: and(
        eq(schema.syncJobs.userId, c.userId),
        eq(schema.syncJobs.provider, c.provider),
        inArray(schema.syncJobs.status, ["pending", "running"])
      ),
      columns: { id: true },
    });
    if (!existing) {
      await db.insert(schema.syncJobs).values({
        userId: c.userId,
        provider: c.provider,
        kind: "incremental",
        runAfter: nextMorning(),
      });
    }
  }
}

/**
 * Make the user's next sync happen now: pull pending jobs forward, or create
 * incremental jobs for active connections that have none. The caller then
 * runs a tick.
 */
export async function requestImmediateSync(userId: string): Promise<void> {
  const conns = await db.query.connections.findMany({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.status, "active")
    ),
    columns: { provider: true },
  });

  for (const c of conns) {
    // google_calendar has no pull pipeline; apple_health is push-only.
    if (c.provider === "google_calendar" || c.provider === "apple_health")
      continue;

    const bumped = await db
      .update(schema.syncJobs)
      .set({ runAfter: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.syncJobs.userId, userId),
          eq(schema.syncJobs.provider, c.provider),
          eq(schema.syncJobs.status, "pending")
        )
      )
      // Parameterless: the dual-driver union type only shares this overload.
      .returning();

    if (bumped.length === 0) {
      const running = await db.query.syncJobs.findFirst({
        where: and(
          eq(schema.syncJobs.userId, userId),
          eq(schema.syncJobs.provider, c.provider),
          eq(schema.syncJobs.status, "running")
        ),
        columns: { id: true },
      });
      if (!running) {
        await db.insert(schema.syncJobs).values({
          userId,
          provider: c.provider,
          kind: "incremental",
          runAfter: new Date(),
        });
      }
    }
  }
}

/**
 * Bring the user's intervals.icu sync forward to `delayS` seconds from now
 * — or leave it alone if one's already scheduled at least that soon. Used
 * by the Strava webhook (src/lib/sync/strava-webhook.ts) to react to a new
 * ride without waiting for the 15-min activity poll or the daily sync. The
 * delay gives intervals.icu's own Strava ingestion a head start, since a
 * pull that runs before intervals.icu has the ride would just miss it.
 * No-ops if the user has no active intervals.icu connection, or a sync for
 * it is already running. Returns whether a job was actually created or
 * brought forward, so callers (e.g. the Strava webhook) can tell a real
 * schedule from a no-op.
 */
export async function scheduleIntervalsSync(
  userId: string,
  delayS = 0
): Promise<boolean> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.provider, "intervals_icu"),
      eq(schema.connections.status, "active")
    ),
    columns: { id: true },
  });
  if (!connection) return false;

  const runAfter = new Date(Date.now() + delayS * 1000);

  const existing = await db.query.syncJobs.findFirst({
    where: and(
      eq(schema.syncJobs.userId, userId),
      eq(schema.syncJobs.provider, "intervals_icu"),
      inArray(schema.syncJobs.status, ["pending", "running"])
    ),
  });
  if (existing?.status === "running") return false;
  if (existing) {
    if (existing.runAfter <= runAfter) return false;
    await db
      .update(schema.syncJobs)
      .set({ runAfter, updatedAt: new Date() })
      .where(eq(schema.syncJobs.id, existing.id));
    return true;
  }

  await db.insert(schema.syncJobs).values({
    userId,
    provider: "intervals_icu",
    kind: "incremental",
    runAfter,
  });
  return true;
}

/** Most recent lastSyncAt across all of a user's connections, or null. */
export async function getLastSyncAt(userId: string): Promise<string | null> {
  const conns = await db.query.connections.findMany({
    where: eq(schema.connections.userId, userId),
    columns: { lastSyncAt: true },
  });
  const last = conns
    .map((c) => c.lastSyncAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return last?.toISOString() ?? null;
}

/**
 * One scheduler tick: claim due jobs (single runner via pg advisory lock,
 * SKIP LOCKED against concurrent claimers, stale-"running" reclaim) and
 * process them. Safe to call from both the in-process interval and /api/cron.
 * pg driver only — the Neon HTTP driver has no advisory locks (docs/PLAN.md).
 */
export async function runSchedulerTick(
  processor: JobProcessor = defaultProcessor
): Promise<{ claimed: number; failed: number }> {
  if (process.env.DATABASE_DRIVER !== "pg") {
    logger.warn("scheduler tick skipped: requires DATABASE_DRIVER=pg");
    return { claimed: 0, failed: 0 };
  }

  const staleCutoff = new Date(Date.now() - STALE_RUNNING_MINUTES * 60_000);

  const claimed = await db.transaction(async (tx) => {
    const lock = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${TICK_LOCK_KEY}) AS locked`
    );
    if (!(lock.rows[0] as { locked: boolean }).locked) return [] as SyncJob[];

    const due = await tx.execute(sql`
      SELECT id FROM sync_jobs
      WHERE (status = 'pending' AND run_after <= now())
         OR (status = 'running' AND updated_at < ${staleCutoff})
      ORDER BY run_after ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `);
    const ids = (due.rows as { id: string }[]).map((r) => r.id);
    if (ids.length === 0) return [] as SyncJob[];

    return tx
      .update(schema.syncJobs)
      .set({ status: "running", updatedAt: new Date() })
      .where(inArray(schema.syncJobs.id, ids))
      .returning();
  });

  let failed = 0;
  for (const job of claimed) {
    try {
      await processor(job);
      await db
        .update(schema.syncJobs)
        .set({ status: "done", updatedAt: new Date(), lastError: null })
        .where(eq(schema.syncJobs.id, job.id));
      // Chain the next daily run.
      await db.insert(schema.syncJobs).values({
        userId: job.userId,
        provider: job.provider,
        kind: "incremental",
        runAfter: nextMorning(),
      });
      // Daily plan adaptation + morning insight + morning push now share
      // one hook with Apple Health ingest and manual wellness entry (event-
      // driven sync triggers, docs/specs/2026-07-26-event-driven-sync-
      // triggers-design.md) — whichever source completes first fires it.
      // Guards inside each step; this never touches the sync job itself.
      try {
        const { onWellnessDataChanged } =
          await import("@/lib/sync/wellness-changed");
        await onWellnessDataChanged(job.userId);
      } catch (err) {
        logger.error("wellness-changed hook failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // Weekly review — guards inside ensure at-most-once/week.
      try {
        const { generateWeeklyReview } = await import("@/lib/weekly-review");
        await generateWeeklyReview(job.userId);
      } catch (err) {
        logger.error("weekly review failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // v0.20 weekly availability prompt — guards inside ensure it stays
      // quiet once confirmed or once the window has passed; never touches
      // the sync job.
      try {
        const { promptAvailability } =
          await import("@/lib/week-plan/availability-prompt");
        await promptAvailability(job.userId);
      } catch (err) {
        logger.error("availability prompt failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // v0.15 monthly report — guards inside ensure at-most-once/month.
      try {
        const { generateMonthlyReport } = await import("@/lib/monthly-report");
        await generateMonthlyReport(job.userId);
      } catch (err) {
        logger.error("monthly report failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // v0.14 post-race debrief — guards inside make it once per race.
      try {
        const { runRaceDebriefs } = await import("@/lib/race/debrief");
        await runRaceDebriefs(job.userId);
      } catch (err) {
        logger.error("race debrief failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // v0.15 debrief lifecycle — covers overnight uploads the poll slept
      // through. Guards inside; never touches the sync job.
      try {
        const { runDebriefLifecycle } = await import("@/lib/debrief/lifecycle");
        await runDebriefLifecycle(job.userId);
      } catch (err) {
        logger.error("debrief lifecycle hook failed", {
          userId: job.userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
      // v0.6 auto-describe — pushes metric descriptions to Strava for
      // opted-in users. This is a catch-up sweep only: describing a brand
      // new activity here (same tick it's promoted to a pending debrief,
      // above) would lock in a description with no review — the MARKER
      // makes that permanent, so describeActivityOnStrava's awaiting_review
      // guard defers those and the real write happens right after the
      // review posts (generateRideReview/runRaceDebriefs call
      // describeActivityOnStravaForUser directly). Guards inside; errors
      // never touch the sync job.
      if (job.provider === "intervals_icu") {
        try {
          const { runAutoDescribeStrava } =
            await import("@/lib/strava-describer");
          await runAutoDescribeStrava(job.userId);
        } catch (err) {
          logger.error("auto-describe failed", {
            userId: job.userId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      const attempts = job.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db
        .update(schema.syncJobs)
        .set({
          status: giveUp ? "failed" : "pending",
          attempts,
          lastError: message,
          // Exponential backoff: 2, 4, 8, 16 minutes.
          runAfter: new Date(Date.now() + 2 ** attempts * 60_000),
          updatedAt: new Date(),
        })
        .where(eq(schema.syncJobs.id, job.id));
      logger.error("sync job failed", { jobId: job.id, attempts, message });
    }
  }

  // Ghost-thread housekeeping — guarded like the push hook: never break the tick.
  try {
    const purged = await purgeEphemeralThreads();
    if (purged > 0) logger.info("ghost threads purged", { purged });
  } catch (err) {
    logger.error("ghost purge failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // v0.12.2 EMA decay refresh — guarded the same way.
  try {
    const refreshed = await refreshDailyDecay();
    if (refreshed > 0) logger.info("daily decay refreshed", { refreshed });
  } catch (err) {
    logger.error("daily decay refresh failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // v0.15 activity poll — near-real-time ride detection; guarded like the
  // rest, never breaks the tick.
  if (providerPassesEnabled()) {
    try {
      const { runActivityPolls } = await import("@/lib/sync/activity-poll");
      const polled = await runActivityPolls();
      if (polled > 0) logger.info("activity polls ran", { polled });
    } catch (err) {
      logger.error("activity poll pass failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // v0.33 wellness refresh — the Companion iOS app writes to intervals.icu
  // ~95 min after the SYNC_HOUR pull, so last night's sleep needs a bounded
  // morning re-pull to land today instead of tomorrow.
  //
  // Skipped under vitest for the reason on providerPassesEnabled; covered
  // directly by tests/wellness-refresh.test.ts.
  if (providerPassesEnabled()) {
    try {
      const { runWellnessRefresh } =
        await import("@/lib/sync/wellness-refresh");
      const refreshed = await runWellnessRefresh();
      if (refreshed > 0) logger.info("wellness refresh ran", { refreshed });
    } catch (err) {
      logger.error("wellness refresh pass failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Morning brief backstop (+ weekly/monthly re-check past BACKSTOP_HOUR) —
  // guarded like the rest, never breaks the tick.
  try {
    const backstopped = await runMorningBriefBackstop();
    if (backstopped > 0) {
      logger.info("morning brief backstop fired", { backstopped });
    }
  } catch (err) {
    logger.error("morning brief backstop pass failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (claimed.length > 0) {
    logger.info("scheduler tick", { claimed: claimed.length, failed });
  }
  return { claimed: claimed.length, failed };
}

/**
 * Refresh today's daily_metrics for users nothing else will touch today
 * (v0.12.2 audit fix). CTL/ATL are EMAs that must decay through restful
 * days, but computeDailyMetrics only ran from sync and write paths — a
 * manual-only athlete's dashboard froze at its last-written values. Any
 * user with metrics history but no row for today gets one recompute; the
 * recompute writes today's row, so each user runs at most once per day.
 */
export async function refreshDailyDecay(): Promise<number> {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const stale = await db.execute(sql`
    SELECT DISTINCT user_id FROM daily_metrics dm
    WHERE NOT EXISTS (
      SELECT 1 FROM daily_metrics d2
      WHERE d2.user_id = dm.user_id AND d2.date >= ${today}
    )
    LIMIT 100
  `);
  const userIds = (stale.rows as { user_id: string }[]).map((r) => r.user_id);
  if (userIds.length === 0) return 0;

  const { computeDailyMetrics } = await import("@/lib/metrics");
  let refreshed = 0;
  for (const userId of userIds) {
    try {
      await computeDailyMetrics(userId, today);
      refreshed++;
    } catch (err) {
      logger.error("decay refresh failed for user", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return refreshed;
}

/**
 * Past BACKSTOP_HOUR server-local, force a morning brief for every user
 * with an active connection who hasn't had one fire today via the
 * event-driven path — bypassing generateMorningInsight's calibrating gate,
 * same honest degraded ("calibrating") text it already produces for a
 * race-day athlete with no readiness yet. Also re-checks weekly/monthly
 * review (bounded to a narrow window near the top of the hour — see
 * `withinReviewWindow` below) so their slot can live at BACKSTOP_HOUR too.
 *
 * Each user is skipped entirely — before onWellnessDataChanged is even
 * called — once getLatestMorningInsight shows today's brief already
 * exists. onWellnessDataChanged unconditionally re-runs runDailyAdaptation
 * regardless of whether the insight itself is a no-op, and adaptDay's
 * red/amber band scaling is NOT idempotent: re-running it against an
 * already-adapted day keeps scaling the same stored duration down every
 * call (and appends a fresh plan_adjustments row every time). Running the
 * full hook every tick past the hour is therefore only safe for a user who
 * hasn't had a brief yet today — once one exists, only the weekly/monthly
 * re-check below still applies to that user. Returns how many users
 * actually got a new brief this call.
 *
 * `opts.userIds`, when given, additionally restricts the DB-wide connections
 * query to that set — this is a test-only safety valve. This function's
 * production call site (scheduler.ts's runSchedulerTick) always calls it
 * with no options, so this restriction never applies outside tests. It
 * exists because this is a DB-wide guarded scheduler pass, tested against a
 * shared dev/live database (this repo's DB-gated tests have no separate
 * test database), that writes real user-facing content (a "Still
 * calibrating" chat message) into whichever real rows the unscoped query
 * happens to match — an unscoped run previously fired for real against a
 * live user during this suite's own test run, writing a stray message into
 * their real coaching thread. See activity-poll.ts's `runActivityPolls` for
 * the identical pattern, established after that function hit the same class
 * of incident first.
 */
export async function runMorningBriefBackstop(
  now = new Date(),
  opts?: { userIds?: string[] }
): Promise<number> {
  if (now.getHours() < BACKSTOP_HOUR) return 0;

  const active = await db.query.connections.findMany({
    where: and(
      eq(schema.connections.status, "active"),
      opts?.userIds
        ? inArray(schema.connections.userId, opts.userIds)
        : undefined
    ),
    columns: { userId: true },
  });
  const userIds = [...new Set(active.map((c) => c.userId))];

  const { onWellnessDataChanged } = await import("@/lib/sync/wellness-changed");
  const { getLatestMorningInsight } = await import("@/lib/morning-insight");
  const { generateWeeklyReview } = await import("@/lib/weekly-review");
  const { generateMonthlyReport } = await import("@/lib/monthly-report");

  // generateWeeklyReview/generateMonthlyReport can return without writing
  // anything when data is insufficient (weekly: <3 non-Strava activities in
  // 7 days; monthly: sessions < MIN_SESSIONS) — their own "has a message
  // been written since the slot?" guards never advance in that case, so an
  // unbounded re-check would re-run (and log-spam) on every tick past
  // BACKSTOP_HOUR, forever, for an athlete who simply never accumulates
  // enough data (the monthly case can never self-resolve, since last
  // month's session count is fixed). Bounding the re-check to a ~5-minute
  // window at the top of the hour keeps it to ~5 attempts/day at the 60s
  // tick instead of ~900, while still tolerating a missed tick.
  const withinReviewWindow =
    now.getHours() === BACKSTOP_HOUR && now.getMinutes() < 5;

  let fired = 0;
  for (const userId of userIds) {
    try {
      const already = await getLatestMorningInsight(userId, now);
      if (!already) {
        const outcome = await onWellnessDataChanged(userId, {
          now,
          force: true,
        });
        if (outcome === "fired") fired++;
      }
    } catch (err) {
      logger.error("morning brief backstop failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (!withinReviewWindow) continue;

    try {
      await generateWeeklyReview(userId);
    } catch (err) {
      logger.error("weekly review backstop check failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await generateMonthlyReport(userId);
    } catch (err) {
      logger.error("monthly report backstop check failed", {
        userId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return fired;
}

/** Delete ghost (ephemeral) threads idle for 24h; messages cascade. */
export async function purgeEphemeralThreads(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .delete(schema.chatThreads)
    .where(
      and(
        eq(schema.chatThreads.ephemeral, true),
        lt(schema.chatThreads.updatedAt, cutoff)
      )
    )
    .returning();
  return rows.length;
}

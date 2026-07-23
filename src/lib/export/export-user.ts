import { eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

/**
 * Full GDPR/personal-data export — every table that holds this user's own
 * content, one array per table, secrets stripped. Read-only: every query
 * below is scoped to `userId` (directly, or via a join through a
 * user-owned parent for tables that have no `userId` column of their own).
 *
 * v0.20 Task 10 (wipe + import round-trip drill) mirrors this exact shape
 * with `importUserData` — if you add a table here, add it there too, and
 * update the inclusion/exclusion table in
 * `.superpowers/sdd/task-9-report.md`.
 *
 * ── Table-by-table decision (see task-9-report.md for full reasoning) ──
 *
 * INCLUDED, verbatim (direct `userId` column, no secrets, user-authored
 * or user-entered content):
 *   wellness_daily, daily_metrics, chat_threads, coach_memories,
 *   biomarkers, body_prefs, notification_prefs, journal_prefs, races,
 *   training_plans, week_plans, llm_usage
 *
 * INCLUDED, field-stripped (direct `userId` column, but the row itself
 * carries a secret/credential that must never leave the server):
 *   activities        — `raw` (bulky raw provider payload) dropped;
 *                        aggregate fields (avgHr, avgPower, load, ...)
 *                        already capture what matters.
 *   llm_settings       — `encryptedApiKey` dropped.
 *   api_tokens         — only id/label/scopes/lastUsedAt/revokedAt/
 *                        createdAt kept; `tokenHash` and `lookupPrefix`
 *                        (both derived from the secret token) dropped.
 *   connections        — only provider/status/provenance fields kept;
 *                        `encryptedAccessToken`/`encryptedRefreshToken`
 *                        dropped (an encrypted blob is still a secret
 *                        artifact tied to this server's ENCRYPTION_KEY).
 *   webhook_subscriptions — `encryptedSecret` dropped.
 *
 * INCLUDED, via a join (no `userId` column of their own, but they hold
 * the substantive content of a user-owned parent row — irreplaceable,
 * not re-fetchable from anywhere external):
 *   chat_messages      — joined via chat_threads.id
 *   training_blocks    — joined via training_plans.id
 *   plan_adjustments   — joined via week_plans.id
 *   activity_streams   — joined via activities.id; per-activity HR/power/
 *                        velocity/altitude time-series (the `data` jsonb
 *                        column is the substantive content, not a
 *                        provider-blob field to strip — same treatment as
 *                        training_blocks.workouts elsewhere in this file).
 *                        No userId column of its own, and — unlike
 *                        athlete_curves below — no TTL and no refresh job,
 *                        so it does not behave like a cache: once
 *                        populated it's effectively primary content.
 *                        getOrFetchActivityDetail (activity-streams.ts)
 *                        only fetches streams for provider ===
 *                        "intervals_icu"; there is no Strava streams
 *                        connector, so Strava-sourced and manually-logged
 *                        activities' streams can never be re-fetched at
 *                        all. Even for intervals.icu activities,
 *                        "re-fetchable" requires reconnecting the
 *                        provider and revisiting every activity detail
 *                        page one at a time (no bulk backfill exists).
 *                        Excluding this table would make that data
 *                        silently unrecoverable after any real
 *                        export -> wipe -> import cycle, so it's included.
 *
 * EXCLUDED — authentication/session material (never belongs in a data
 * export; equivalent to exporting a password):
 *   sessions           — live session tokens + IP addresses.
 *   accounts           — Better Auth: password hash, OAuth access/
 *                        refresh/id tokens.
 *   verifications      — live email-verification / password-reset
 *                        tokens (also: no userId column).
 *
 * EXCLUDED — operator/security artifacts, not the user's own content:
 *   audit_log          — security/audit trail (logins, token/connection/
 *                        webhook lifecycle events, IP addresses); an
 *                        operator-facing security artifact, and userId is
 *                        nullable/actor-based rather than a clean
 *                        "this row belongs to you" relationship.
 *   invites            — admin-issued invite codes; `code` is itself a
 *                        bearer credential (whoever holds it can create
 *                        an account), and the row isn't the exporting
 *                        user's personal data.
 *   sync_jobs          — background job queue/infra state, visible via
 *                        the ops admin panel; not user content.
 *   webhook_deliveries — delivery/attempt log for webhook infra
 *                        (operational diagnostics); no userId column.
 *
 * EXCLUDED — ephemeral device/subscription state (regenerated on next
 * use; exporting it has no restore value and the subscription keys are
 * themselves secret-like):
 *   push_subscriptions — endpoint + p256dh/auth (push-encryption keys).
 *
 * EXCLUDED — re-fetchable derived cache (explicitly documented as a
 * cache with a TTL in schema.ts; always reconstructable on demand from
 * the provider, so it is not part of "the user's data"):
 *   athlete_curves     — 6h TTL, stale-if-error cache of provider curves.
 *
 * NOT APPLICABLE — instance-level, not per-user:
 *   app_config
 */

// Exported (not just module-local) so import-user.ts can validate a
// submitted export's version against the same single source of truth
// rather than hardcoding a second copy of the number.
export const EXPORT_VERSION = 1;

export interface UserExport {
  version: number;
  exported_at: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    createdAt: Date;
  } | null;
  wellness_daily: (typeof schema.wellnessDaily.$inferSelect)[];
  activities: Omit<typeof schema.activities.$inferSelect, "raw">[];
  daily_metrics: (typeof schema.dailyMetrics.$inferSelect)[];
  chat_threads: (typeof schema.chatThreads.$inferSelect)[];
  chat_messages: (typeof schema.chatMessages.$inferSelect)[];
  coach_memories: (typeof schema.coachMemories.$inferSelect)[];
  biomarkers: (typeof schema.biomarkers.$inferSelect)[];
  body_prefs: (typeof schema.bodyPrefs.$inferSelect)[];
  notification_prefs: (typeof schema.notificationPrefs.$inferSelect)[];
  journal_prefs: (typeof schema.journalPrefs.$inferSelect)[];
  llm_settings: Omit<
    typeof schema.llmSettings.$inferSelect,
    "encryptedApiKey"
  >[];
  races: (typeof schema.races.$inferSelect)[];
  training_plans: (typeof schema.trainingPlans.$inferSelect)[];
  training_blocks: (typeof schema.trainingBlocks.$inferSelect)[];
  week_plans: (typeof schema.weekPlans.$inferSelect)[];
  plan_adjustments: (typeof schema.planAdjustments.$inferSelect)[];
  activity_streams: (typeof schema.activityStreams.$inferSelect)[];
  api_tokens: {
    id: string;
    label: string;
    scopes: string;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }[];
  connections: {
    id: string;
    provider: (typeof schema.connections.$inferSelect)["provider"];
    externalAthleteId: string;
    externalAthleteName: string | null;
    status: (typeof schema.connections.$inferSelect)["status"];
    lastSyncAt: Date | null;
    lastActivityPollAt: Date | null;
    stravaWriteEnabled: boolean;
    expiresAt: Date | null;
    createdAt: Date;
  }[];
  webhook_subscriptions: {
    id: string;
    url: string;
    events: string[];
    active: boolean;
    createdAt: Date;
  }[];
  llm_usage: (typeof schema.llmUsage.$inferSelect)[];
}

export async function exportUserData(
  db: Database,
  userId: string
): Promise<UserExport> {
  const [
    user,
    wellnessDaily,
    activitiesRaw,
    dailyMetrics,
    chatThreads,
    coachMemories,
    biomarkers,
    bodyPrefs,
    notificationPrefs,
    journalPrefs,
    llmSettingsRaw,
    races,
    trainingPlans,
    weekPlans,
    apiTokensRaw,
    connectionsRaw,
    webhookSubscriptionsRaw,
    llmUsage,
  ] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
    db.query.wellnessDaily.findMany({
      where: eq(schema.wellnessDaily.userId, userId),
      orderBy: schema.wellnessDaily.date,
    }),
    db.query.activities.findMany({
      where: eq(schema.activities.userId, userId),
      orderBy: schema.activities.startDate,
    }),
    db.query.dailyMetrics.findMany({
      where: eq(schema.dailyMetrics.userId, userId),
      orderBy: schema.dailyMetrics.date,
    }),
    db.query.chatThreads.findMany({
      where: eq(schema.chatThreads.userId, userId),
    }),
    db.query.coachMemories.findMany({
      where: eq(schema.coachMemories.userId, userId),
    }),
    db.query.biomarkers.findMany({
      where: eq(schema.biomarkers.userId, userId),
    }),
    db.query.bodyPrefs.findMany({
      where: eq(schema.bodyPrefs.userId, userId),
    }),
    db.query.notificationPrefs.findMany({
      where: eq(schema.notificationPrefs.userId, userId),
    }),
    db.query.journalPrefs.findMany({
      where: eq(schema.journalPrefs.userId, userId),
    }),
    db.query.llmSettings.findMany({
      where: eq(schema.llmSettings.userId, userId),
    }),
    db.query.races.findMany({ where: eq(schema.races.userId, userId) }),
    db.query.trainingPlans.findMany({
      where: eq(schema.trainingPlans.userId, userId),
    }),
    db.query.weekPlans.findMany({
      where: eq(schema.weekPlans.userId, userId),
    }),
    db.query.apiTokens.findMany({
      where: eq(schema.apiTokens.userId, userId),
    }),
    db.query.connections.findMany({
      where: eq(schema.connections.userId, userId),
    }),
    db.query.webhookSubscriptions.findMany({
      where: eq(schema.webhookSubscriptions.userId, userId),
    }),
    db.query.llmUsage.findMany({
      where: eq(schema.llmUsage.userId, userId),
    }),
  ]);

  // Child tables with no userId column of their own — scoped via the
  // already-userId-scoped parent ids above. inArray([]) safely compiles to
  // `false` (drizzle-orm), so an empty parent set just yields no rows.
  const threadIds = chatThreads.map((t) => t.id);
  const planIds = trainingPlans.map((p) => p.id);
  const weekPlanIds = weekPlans.map((w) => w.id);
  const activityIds = activitiesRaw.map((a) => a.id);

  const [chatMessages, trainingBlocks, planAdjustments, activityStreams] =
    await Promise.all([
      db.query.chatMessages.findMany({
        where: inArray(schema.chatMessages.threadId, threadIds),
      }),
      db.query.trainingBlocks.findMany({
        where: inArray(schema.trainingBlocks.planId, planIds),
      }),
      db.query.planAdjustments.findMany({
        where: inArray(schema.planAdjustments.weekPlanId, weekPlanIds),
      }),
      db.query.activityStreams.findMany({
        where: inArray(schema.activityStreams.activityId, activityIds),
      }),
    ]);

  return {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt,
        }
      : null,
    wellness_daily: wellnessDaily,
    // Allowlist, not a `raw`-omitting destructure: fails safe if a future
    // schema change adds another bulky/secret field to this wide table.
    activities: activitiesRaw.map((a) => ({
      id: a.id,
      userId: a.userId,
      provider: a.provider,
      externalId: a.externalId,
      startDate: a.startDate,
      sport: a.sport,
      name: a.name,
      durationS: a.durationS,
      distanceM: a.distanceM,
      load: a.load,
      avgHr: a.avgHr,
      avgPower: a.avgPower,
      elevationM: a.elevationM,
      perceivedExertion: a.perceivedExertion,
      feel: a.feel,
      debriefNotes: a.debriefNotes,
      debriefState: a.debriefState,
      debriefThreadId: a.debriefThreadId,
      reviewedAt: a.reviewedAt,
      reviewAttempts: a.reviewAttempts,
      reviewSummary: a.reviewSummary,
      createdAt: a.createdAt,
    })),
    daily_metrics: dailyMetrics,
    chat_threads: chatThreads,
    chat_messages: chatMessages,
    coach_memories: coachMemories,
    biomarkers,
    body_prefs: bodyPrefs,
    notification_prefs: notificationPrefs,
    journal_prefs: journalPrefs,
    llm_settings: llmSettingsRaw.map((s) => ({
      id: s.id,
      userId: s.userId,
      providerType: s.providerType,
      baseUrl: s.baseUrl,
      model: s.model,
      modelQuick: s.modelQuick,
      modelDeep: s.modelDeep,
      defaultMode: s.defaultMode,
      coachPersonality: s.coachPersonality,
      updatedAt: s.updatedAt,
    })),
    races,
    training_plans: trainingPlans,
    training_blocks: trainingBlocks,
    week_plans: weekPlans,
    plan_adjustments: planAdjustments,
    activity_streams: activityStreams,
    api_tokens: apiTokensRaw.map((t) => ({
      id: t.id,
      label: t.label,
      scopes: t.scopes,
      lastUsedAt: t.lastUsedAt,
      revokedAt: t.revokedAt,
      createdAt: t.createdAt,
    })),
    connections: connectionsRaw.map((c) => ({
      id: c.id,
      provider: c.provider,
      externalAthleteId: c.externalAthleteId,
      externalAthleteName: c.externalAthleteName,
      status: c.status,
      lastSyncAt: c.lastSyncAt,
      lastActivityPollAt: c.lastActivityPollAt,
      stravaWriteEnabled: c.stravaWriteEnabled,
      expiresAt: c.expiresAt,
      createdAt: c.createdAt,
    })),
    webhook_subscriptions: webhookSubscriptionsRaw.map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events,
      active: w.active,
      createdAt: w.createdAt,
    })),
    llm_usage: llmUsage,
  };
}

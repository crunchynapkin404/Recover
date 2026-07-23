import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import { EXPORT_VERSION, type UserExport } from "./export-user";

// `UserExport`'s timestamp fields are typed as `Date` (they come straight
// off exportUserData's drizzle `$inferSelect` reads), but the real caller
// of importUserData is /api/import-account, which gets its `data` from
// `req.json()` — and a JSON round trip turns every Date into an ISO
// string, which it stays as (JSON.parse never revives strings back into
// Dates). Drizzle's `timestamp`/`timestamptz` columns call
// `value.toISOString()` when binding an insert parameter, which throws on
// a plain string. `date`-typed columns (wellnessDaily.date, races.date,
// etc.) are unaffected — they're string-mode in this schema already, both
// coming out of the DB and going back in. Every `timestamp`/`timestamptz`
// field this file inserts is routed through one of these two helpers so
// it works identically whether `data` came from a real JSON hop (the
// route) or an in-memory object (the unit test / drill script).
function toDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}
function toDateOrNull(v: Date | string | null): Date | null {
  return v == null ? null : toDate(v);
}

/**
 * Import a `UserExport` (see `export-user.ts`) into an *existing* user's
 * account. Mirrors `exportUserData`'s table list exactly — if a table is
 * added to that export, it must be added here too.
 *
 * ── Preconditions the caller must guarantee ─────────────────────────────
 * - `targetUserId` already exists in `users`. This function never inserts,
 *   updates, or otherwise touches the `users` table — `data.user` is
 *   ignored entirely. (A GDPR *import* restores a user's content into an
 *   account; it is not an account-creation flow.)
 * - The target user should have no existing rows in the tables below,
 *   particularly the four one-row-per-user tables (`body_prefs`,
 *   `notification_prefs`, `journal_prefs`, `llm_settings`, each
 *   `userId`-unique). Importing into an account that already has rows
 *   there will fail the whole transaction on a unique-constraint violation
 *   (safe — all-or-nothing, see below) rather than silently over-writing
 *   or duplicating existing settings. This function intentionally does
 *   not upsert/merge: "restore my exported data into a fresh or
 *   freshly-wiped account" is the supported use case, not "merge a backup
 *   into my currently-active account."
 *
 * ── Atomicity ────────────────────────────────────────────────────────────
 * The whole import runs inside one `db.transaction`. Any failure (e.g. a
 * unique-constraint hit on the singleton-prefs tables above) rolls back
 * everything already inserted in this call — the target user is left
 * exactly as they were before `importUserData` was invoked, never
 * partially imported.
 *
 * ── Fresh ids + FK remapping ─────────────────────────────────────────────
 * Every row gets a newly DB-generated id (the exported `id` is read only
 * to build an old-id -> new-id map while its row's insert is in flight,
 * then discarded — it is never written to the target database). Every FK
 * column that points at a re-generated parent id is rewritten through
 * that parent's map before the child row is inserted, so a chat message's
 * `threadId` (for example) always names the *new* thread row, never the
 * id it had in the export.
 *
 * ── FK-safe insert order (verified against schema.ts's `.references()`
 * declarations — NOT the same order as the task-10 brief's sketch; see
 * task-10-report.md for the full discrepancy writeup) ────────────────────
 * The brief's sketch grouped `races` with the plain-userId tables, ahead
 * of `activities` and `chat_threads`. That's wrong: `races.resultActivityId`
 * references `activities.id`, and `activities.debriefThreadId` references
 * `chat_threads.id` (both nullable, `onDelete: "set null"`, but still real
 * FKs enforced on insert if non-null). Inserting in the brief's order
 * while remapping those columns would try to point at ids that don't
 * exist yet; inserting in that order *without* remapping would silently
 * drop the links. Neither is acceptable for a "lossless" round trip.
 *
 * The actual dependency graph (A -> B means "A has a FK into B"):
 *   activities       -> chat_threads   (debriefThreadId, nullable)
 *   races             -> activities     (resultActivityId, nullable)
 *   training_plans     -> races          (raceId, nullable)
 *   activity_streams  -> activities     (activityId, NOT NULL)
 *   chat_messages     -> chat_threads   (threadId, NOT NULL)
 *   training_blocks    -> training_plans  (planId, NOT NULL)
 *   week_plans        -> training_plans  (planId, NOT NULL)
 *   plan_adjustments   -> week_plans      (weekPlanId, NOT NULL)
 * This is an acyclic chain (chat_threads -> activities -> races ->
 * training_plans -> {training_blocks, week_plans} -> plan_adjustments), so
 * inserting in that order and remapping each nullable/required FK
 * immediately (using the map already built for its parent) needs no
 * null-then-patch second pass. Order used below:
 *   1. chat_threads
 *   2. activities        (debriefThreadId <- chat_threads map)
 *   3. activity_streams  (activityId <- activities map)
 *   4. chat_messages     (threadId <- chat_threads map)
 *   5. races             (resultActivityId <- activities map)
 *   6. training_plans    (raceId <- races map)
 *   7. training_blocks   (planId <- training_plans map)
 *   8. week_plans        (planId <- training_plans map)
 *   9. plan_adjustments  (weekPlanId <- week_plans map)
 * Every other table (wellness_daily, daily_metrics, body_prefs,
 * notification_prefs, journal_prefs, llm_settings, biomarkers, llm_usage,
 * coach_memories) has only a direct `userId` FK and no id anything else
 * depends on, so it can be inserted at any point — done first, below.
 *
 * ── The three secret-stripped tables: connections, api_tokens,
 * webhook_subscriptions ──────────────────────────────────────────────────
 * Decision: SKIPPED ENTIRELY on import. Not "imported with nulled secret
 * columns" — actually structurally impossible, not just undesirable:
 *   - connections.encryptedAccessToken is `text(...).notNull()`
 *   - api_tokens.tokenHash is `text(...).notNull().unique()`
 *   - webhook_subscriptions.encryptedSecret is `text(...).notNull()`
 * All three secret columns are NOT NULL in schema.ts, and none of the
 * three values exist in the export (stripped at export time by design —
 * see export-user.ts's header comment). There is no value we could
 * legitimately insert: fabricating a placeholder secret would create a
 * connection/token/webhook row that *looks* configured but holds a
 * useless or actively-misleading credential (a "connected" Strava
 * connection with a garbage access token would appear active in the UI
 * until it fails on next use). Skipping is the only option that doesn't
 * either violate the NOT NULL constraint or invent fake credential
 * material, and it matches the export doc's own framing of these rows as
 * describing "now-invalid credentials" once separated from their secret.
 * (`llm_settings.encryptedApiKey`, by contrast, *is* nullable in
 * schema.ts, so that table imports normally with the column left null —
 * it was never one of "the three".)
 */
export async function importUserData(
  db: Database,
  targetUserId: string,
  data: UserExport
): Promise<void> {
  if (data.version !== EXPORT_VERSION) {
    throw new Error(
      `importUserData: unsupported export version ${data.version} (expected ${EXPORT_VERSION})`
    );
  }

  await db.transaction(async (tx) => {
    // ── Group A: direct-userId only, nothing downstream depends on their
    // ids, so plain bulk inserts (no id capture needed). ──────────────────

    if (data.wellness_daily.length) {
      await tx.insert(schema.wellnessDaily).values(
        data.wellness_daily.map((r) => ({
          userId: targetUserId,
          date: r.date,
          hrvMs: r.hrvMs,
          restingHr: r.restingHr,
          sleepSecs: r.sleepSecs,
          sleepScore: r.sleepScore,
          sleepDeepSecs: r.sleepDeepSecs,
          sleepRemSecs: r.sleepRemSecs,
          sleepLightSecs: r.sleepLightSecs,
          sleepAwakeSecs: r.sleepAwakeSecs,
          bedStart: toDateOrNull(r.bedStart),
          bedEnd: toDateOrNull(r.bedEnd),
          tempDeviationC: r.tempDeviationC,
          respiratoryRate: r.respiratoryRate,
          systolic: r.systolic,
          diastolic: r.diastolic,
          bodyFatPct: r.bodyFatPct,
          ctl: r.ctl,
          atl: r.atl,
          eftp: r.eftp,
          weightKg: r.weightKg,
          energy1_10: r.energy1_10,
          soreness1_10: r.soreness1_10,
          stress1_10: r.stress1_10,
          mood: r.mood,
          tags: r.tags,
          dayFlags: r.dayFlags,
          notes: r.notes,
          // `search` is a GENERATED ALWAYS AS column — Postgres computes it
          // from `notes`; it must never be assigned explicitly.
          source: r.source,
          fieldSources: r.fieldSources,
          raw: r.raw,
          updatedAt: toDate(r.updatedAt),
        }))
      );
    }

    if (data.daily_metrics.length) {
      await tx.insert(schema.dailyMetrics).values(
        data.daily_metrics.map((r) => ({
          userId: targetUserId,
          date: r.date,
          readiness: r.readiness,
          band: r.band,
          componentScores: r.componentScores,
          hrvBaselineMean: r.hrvBaselineMean,
          hrvBaselineSd: r.hrvBaselineSd,
          rhrBaselineMean: r.rhrBaselineMean,
          rhrBaselineSd: r.rhrBaselineSd,
          tsb: r.tsb,
          ctl: r.ctl,
          atl: r.atl,
          loadSource: r.loadSource,
          computedAt: toDate(r.computedAt),
        }))
      );
    }

    if (data.body_prefs.length) {
      await tx.insert(schema.bodyPrefs).values(
        data.body_prefs.map((r) => ({
          userId: targetUserId,
          wakeTime: r.wakeTime,
          sleepNeedSecs: r.sleepNeedSecs,
          maxHr: r.maxHr,
          ftpWatts: r.ftpWatts,
          birthYear: r.birthYear,
        }))
      );
    }

    if (data.notification_prefs.length) {
      await tx.insert(schema.notificationPrefs).values(
        data.notification_prefs.map((r) => ({
          userId: targetUserId,
          morningPushEnabled: r.morningPushEnabled,
          lastMorningPushDate: r.lastMorningPushDate,
          weeklyReviewDay: r.weeklyReviewDay,
          weeklyReviewHour: r.weeklyReviewHour,
          autoDescribeStrava: r.autoDescribeStrava,
          stravaDescriptionFields: r.stravaDescriptionFields,
          rideDebriefsEnabled: r.rideDebriefsEnabled,
          debriefPushEnabled: r.debriefPushEnabled,
        }))
      );
    }

    if (data.journal_prefs.length) {
      await tx.insert(schema.journalPrefs).values(
        data.journal_prefs.map((r) => ({
          userId: targetUserId,
          usualBehaviorTags: r.usualBehaviorTags,
        }))
      );
    }

    if (data.llm_settings.length) {
      await tx.insert(schema.llmSettings).values(
        data.llm_settings.map((r) => ({
          userId: targetUserId,
          providerType: r.providerType,
          baseUrl: r.baseUrl,
          // encryptedApiKey intentionally omitted (-> column default null).
          // Nullable in schema.ts, so unlike connections/api_tokens/
          // webhook_subscriptions this table can still be imported — the
          // user just has to re-enter their API key afterward.
          model: r.model,
          modelQuick: r.modelQuick,
          modelDeep: r.modelDeep,
          defaultMode: r.defaultMode,
          coachPersonality: r.coachPersonality,
          updatedAt: toDate(r.updatedAt),
        }))
      );
    }

    if (data.biomarkers.length) {
      await tx.insert(schema.biomarkers).values(
        data.biomarkers.map((r) => ({
          userId: targetUserId,
          name: r.name,
          displayName: r.displayName,
          category: r.category,
          value: r.value,
          unit: r.unit,
          measuredAt: r.measuredAt,
          source: r.source,
          confidence: r.confidence,
          rawLabel: r.rawLabel,
          createdAt: toDate(r.createdAt),
        }))
      );
    }

    if (data.llm_usage.length) {
      await tx.insert(schema.llmUsage).values(
        data.llm_usage.map((r) => ({
          userId: targetUserId,
          model: r.model,
          slot: r.slot,
          purpose: r.purpose,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          createdAt: toDate(r.createdAt),
        }))
      );
    }

    if (data.coach_memories.length) {
      await tx.insert(schema.coachMemories).values(
        data.coach_memories.map((r) => ({
          userId: targetUserId,
          category: r.category,
          content: r.content,
          createdAt: toDate(r.createdAt),
          updatedAt: toDate(r.updatedAt),
        }))
      );
    }

    // ── Group B: the acyclic FK chain. Each table is inserted row-by-row
    // (not bulk + zip-by-index) so the old->new id map is built from an
    // explicit, unambiguous pairing rather than relying on multi-row
    // INSERT...RETURNING preserving input order. ──────────────────────────

    const threadIdMap = new Map<string, string>();
    for (const r of data.chat_threads) {
      const [inserted] = await tx
        .insert(schema.chatThreads)
        .values({
          userId: targetUserId,
          title: r.title,
          kind: r.kind,
          ephemeral: r.ephemeral,
          createdAt: toDate(r.createdAt),
          updatedAt: toDate(r.updatedAt),
        })
        .returning();
      threadIdMap.set(r.id, inserted.id);
    }

    const activityIdMap = new Map<string, string>();
    for (const r of data.activities) {
      const [inserted] = await tx
        .insert(schema.activities)
        .values({
          userId: targetUserId,
          provider: r.provider,
          externalId: r.externalId,
          startDate: toDate(r.startDate),
          sport: r.sport,
          name: r.name,
          durationS: r.durationS,
          distanceM: r.distanceM,
          load: r.load,
          avgHr: r.avgHr,
          avgPower: r.avgPower,
          elevationM: r.elevationM,
          // `raw` was stripped at export time; left unset (-> null).
          perceivedExertion: r.perceivedExertion,
          feel: r.feel,
          debriefNotes: r.debriefNotes,
          debriefState: r.debriefState,
          debriefThreadId: r.debriefThreadId
            ? (threadIdMap.get(r.debriefThreadId) ?? null)
            : null,
          reviewedAt: toDateOrNull(r.reviewedAt),
          reviewAttempts: r.reviewAttempts,
          reviewSummary: r.reviewSummary,
          createdAt: toDate(r.createdAt),
        })
        .returning();
      activityIdMap.set(r.id, inserted.id);
    }

    if (data.activity_streams.length) {
      await tx.insert(schema.activityStreams).values(
        data.activity_streams.map((r) => {
          const newActivityId = activityIdMap.get(r.activityId);
          if (!newActivityId) {
            // The export is FK-consistent by construction (activity_streams
            // is queried via the same activity ids just exported), so this
            // only fires if the export itself was tampered with or is from
            // an incompatible version — fail loudly rather than orphan a
            // stream row.
            throw new Error(
              `importUserData: activity_streams row ${r.id} references unknown activity ${r.activityId}`
            );
          }
          return {
            activityId: newActivityId,
            type: r.type,
            data: r.data,
            createdAt: toDate(r.createdAt),
          };
        })
      );
    }

    if (data.chat_messages.length) {
      await tx.insert(schema.chatMessages).values(
        data.chat_messages.map((r) => {
          const newThreadId = threadIdMap.get(r.threadId);
          if (!newThreadId) {
            throw new Error(
              `importUserData: chat_messages row ${r.id} references unknown thread ${r.threadId}`
            );
          }
          return {
            threadId: newThreadId,
            role: r.role,
            content: r.content,
            toolCalls: r.toolCalls,
            createdAt: toDate(r.createdAt),
            // `search` is GENERATED ALWAYS AS from `content` — never set.
          };
        })
      );
    }

    const raceIdMap = new Map<string, string>();
    for (const r of data.races) {
      const [inserted] = await tx
        .insert(schema.races)
        .values({
          userId: targetUserId,
          name: r.name,
          raceType: r.raceType,
          sport: r.sport,
          date: r.date,
          priority: r.priority,
          status: r.status,
          goalNote: r.goalNote,
          resultActivityId: r.resultActivityId
            ? (activityIdMap.get(r.resultActivityId) ?? null)
            : null,
          debriefedAt: toDateOrNull(r.debriefedAt),
          createdAt: toDate(r.createdAt),
          updatedAt: toDate(r.updatedAt),
        })
        .returning();
      raceIdMap.set(r.id, inserted.id);
    }

    const planIdMap = new Map<string, string>();
    for (const r of data.training_plans) {
      const [inserted] = await tx
        .insert(schema.trainingPlans)
        .values({
          userId: targetUserId,
          title: r.title,
          raceType: r.raceType,
          raceDate: r.raceDate,
          startDate: r.startDate,
          weeksTotal: r.weeksTotal,
          currentWeek: r.currentWeek,
          targetCtl: r.targetCtl,
          startingCtl: r.startingCtl,
          status: r.status,
          constraints: r.constraints,
          raceId: r.raceId ? (raceIdMap.get(r.raceId) ?? null) : null,
          createdAt: toDate(r.createdAt),
          updatedAt: toDate(r.updatedAt),
        })
        .returning();
      planIdMap.set(r.id, inserted.id);
    }

    if (data.training_blocks.length) {
      await tx.insert(schema.trainingBlocks).values(
        data.training_blocks.map((r) => {
          const newPlanId = planIdMap.get(r.planId);
          if (!newPlanId) {
            throw new Error(
              `importUserData: training_blocks row ${r.id} references unknown plan ${r.planId}`
            );
          }
          return {
            planId: newPlanId,
            weekNumber: r.weekNumber,
            phase: r.phase,
            targetLoadTotal: r.targetLoadTotal,
            targetSessions: r.targetSessions,
            workouts: r.workouts,
            actualLoad: r.actualLoad,
            actualSessions: r.actualSessions,
            adherencePct: r.adherencePct,
            notes: r.notes,
          };
        })
      );
    }

    const weekPlanIdMap = new Map<string, string>();
    for (const r of data.week_plans) {
      const newPlanId = planIdMap.get(r.planId);
      if (!newPlanId) {
        throw new Error(
          `importUserData: week_plans row ${r.id} references unknown plan ${r.planId}`
        );
      }
      const [inserted] = await tx
        .insert(schema.weekPlans)
        .values({
          userId: targetUserId,
          planId: newPlanId,
          weekStart: r.weekStart,
          skeletonWeek: r.skeletonWeek,
          days: r.days,
          status: r.status,
          effectiveTarget: r.effectiveTarget,
          createdAt: toDate(r.createdAt),
          updatedAt: toDate(r.updatedAt),
        })
        .returning();
      weekPlanIdMap.set(r.id, inserted.id);
    }

    if (data.plan_adjustments.length) {
      await tx.insert(schema.planAdjustments).values(
        data.plan_adjustments.map((r) => {
          const newWeekPlanId = weekPlanIdMap.get(r.weekPlanId);
          if (!newWeekPlanId) {
            throw new Error(
              `importUserData: plan_adjustments row ${r.id} references unknown week_plan ${r.weekPlanId}`
            );
          }
          return {
            weekPlanId: newWeekPlanId,
            date: r.date,
            trigger: r.trigger,
            action: r.action,
            before: r.before,
            after: r.after,
            reason: r.reason,
            createdAt: toDate(r.createdAt),
          };
        })
      );
    }

    // ── connections / api_tokens / webhook_subscriptions: intentionally
    // NOT imported. See the header comment above for why (NOT NULL secret
    // columns with no value in the export). data.connections,
    // data.api_tokens, and data.webhook_subscriptions are read nowhere in
    // this function — left for the caller to report as "N rows skipped"
    // if desired.
  });
}

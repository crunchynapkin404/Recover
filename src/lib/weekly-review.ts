/**
 * Weekly review generator — one proactive summary per user per review cycle,
 * written into the weekly thread (kind='weekly'). LLM-phrased when a provider
 * is configured, deterministic template otherwise. Never throws to callers.
 *
 * Scheduling: fires from the post-sync hook once the user's configured weekly
 * slot (day + hour, default Monday 07:00 — the notification_prefs column
 * default, see FALLBACK_REVIEW_HOUR below) has passed and no review exists
 * since that slot. Also re-checked every scheduler tick past BACKSTOP_HOUR
 * (scheduler.ts) so the slot doesn't have to wait for the next day's sync to
 * notice it's due — before that re-check existed, a 07:00 slot checked only
 * at the once-daily 05:00 sync always read as "not due yet" and fired a full
 * day late, every cycle. Exact-hour matching would silently never fire,
 * because syncs run at SYNC_HOUR, not at the user's review hour.
 */
import { and, desc, eq, gte, lte, ne, count, avg } from "drizzle-orm";
import { generateText } from "ai";
import { db, schema } from "@/lib/db";
import { getActivePlan } from "@/lib/active-plan";
import { logger } from "@/lib/logger";
import { resolveProvider } from "@/lib/llm-provider";
import { recordLlmUsage } from "@/lib/llm-usage";
import { buildSystemPrompt, languageDirective } from "@/lib/coach-persona";
import { deriveDayActuals } from "@/lib/week-plan/actuals";
import { mondayOf, addDaysYmd } from "@/lib/week-plan/service";
import { ctlBaselineYmd } from "@/lib/weekly-review-window";
import { weekAdherencePct, weekTargetLoad } from "@/lib/week-plan/volume";

export const WEEKLY_THREAD_TITLE = "Weekly Review";
/**
 * Fallback weekly/monthly review hour used ONLY when a user has no
 * notification_prefs row at all — `notification_prefs.weekly_review_hour`
 * is `smallint NOT NULL DEFAULT 7` (schema.ts), so for every user who has a
 * prefs row (getOrCreatePrefs in push.ts creates one for every user) this
 * constant is never consulted; the operative default is the column's own 7,
 * not this value. Kept distinct from BACKSTOP_HOUR (scheduler.ts, 9): that's
 * the hour past which the scheduler re-checks a due review, not the review's
 * own configured slot. No design doc found — a defensive default for a
 * structurally near-unreachable code path. Confidence: Low.
 */
export const FALLBACK_REVIEW_HOUR = 9;

/** Returns "2026-W03" style ISO week string for a given date. */
function isoWeekLabel(d: Date): string {
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const start = new Date(jan4.getTime());
  start.setDate(start.getDate() - ((jan4.getDay() + 6) % 7));
  const diff = d.getTime() - start.getTime();
  const weekNum = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  const year = d.getFullYear();
  return `${year}-W${String(weekNum).padStart(2, "0")}`;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Most recent occurrence of the configured weekly slot, always in the past week. */
export function mostRecentSlot(
  now: Date,
  reviewDay: number,
  reviewHour: number
): Date {
  const slot = new Date(now);
  slot.setHours(reviewHour, 0, 0, 0);
  const dayDiff = (slot.getDay() - reviewDay + 7) % 7;
  slot.setDate(slot.getDate() - dayDiff);
  if (slot > now) slot.setDate(slot.getDate() - 7);
  return slot;
}

async function findOrCreateWeeklyThread(userId: string) {
  const existing = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.userId, userId),
      eq(schema.chatThreads.kind, "weekly")
    ),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(schema.chatThreads)
    .values({ userId, title: WEEKLY_THREAD_TITLE, kind: "weekly" })
    .returning();
  return created;
}

export async function getLatestWeeklyReview(userId: string): Promise<{
  text: string;
  threadId: string;
  createdAt: Date;
} | null> {
  const thread = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.userId, userId),
      eq(schema.chatThreads.kind, "weekly")
    ),
  });
  if (!thread) return null;
  // Reviews are stored as assistant messages so the thread UI renders them.
  const msg = await db.query.chatMessages.findFirst({
    where: and(
      eq(schema.chatMessages.threadId, thread.id),
      eq(schema.chatMessages.role, "assistant")
    ),
    orderBy: [desc(schema.chatMessages.createdAt)],
  });
  if (!msg) return null;
  return { text: msg.content, threadId: thread.id, createdAt: msg.createdAt };
}

export async function generateWeeklyReview(userId: string): Promise<void> {
  const now = new Date();

  // ── Due-since-slot guard ────────────────────────────────────────────────
  const prefs = await db.query.notificationPrefs.findFirst({
    where: eq(schema.notificationPrefs.userId, userId),
  });
  const reviewDay = prefs?.weeklyReviewDay ?? 1; // default Monday
  // FALLBACK_REVIEW_HOUR only applies when prefs is undefined (no row at
  // all) — see its own doc comment above for why that's rare in practice.
  const reviewHour = prefs?.weeklyReviewHour ?? FALLBACK_REVIEW_HOUR;
  const slot = mostRecentSlot(now, reviewDay, reviewHour);

  const weekLabel = isoWeekLabel(now);

  // ── At-most-once-per-cycle guard ───────────────────────────────────────
  const thread = await findOrCreateWeeklyThread(userId);
  const latest = await db.query.chatMessages.findFirst({
    where: eq(schema.chatMessages.threadId, thread.id),
    orderBy: desc(schema.chatMessages.createdAt),
  });
  if (latest && latest.createdAt >= slot) {
    return; // already reviewed this cycle
  }

  // ── Skip if insufficient data ──────────────────────────────────────────
  // This gate is deliberately still a rolling 7-day window off raw
  // start_date — a "did anything happen recently" check, not a reported
  // number, so it does not need calendar-week or local-day bucketing.
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const todayYmd = localYmd(now);

  // Strava-sourced rows are excluded from every aggregate below: these
  // numbers feed the LLM prompt and plan adherence (Strava API AI clause).
  const [activityCount] = await db
    .select({ n: count() })
    .from(schema.activities)
    .where(
      and(
        eq(schema.activities.userId, userId),
        ne(schema.activities.provider, "strava"),
        gte(schema.activities.startDate, sevenDaysAgo)
      )
    );

  if ((activityCount?.n ?? 0) < 3) {
    logger.info("weekly review skipped — insufficient activities", {
      userId,
      count: activityCount?.n ?? 0,
    });
    return;
  }

  // The calendar week that just closed — the same window rolloverWeekPlan
  // uses, so the review's number and the stored number agree BY
  // CONSTRUCTION rather than by coincidence.
  //
  // This replaced a rolling 7-day window over raw start_date. That window
  // was neither a calendar week nor local-day bucketed, and it skipped the
  // coalesce(start_date_local, start_date) every other surface uses — so
  // the athlete was told a number no other screen agreed with, and the
  // message is stored verbatim and never rewritten.
  //
  // deriveDayActuals already excludes Strava (Nov 2024 API agreement) and
  // already coalesces the local timestamp, so routing through it closes all
  // three problems at once.
  const reviewWeekStart = addDaysYmd(mondayOf(now), -7);
  const reviewWeekEnd = addDaysYmd(reviewWeekStart, 6);
  const prevWeekStart = addDaysYmd(reviewWeekStart, -7);

  const [thisWeekDays, prevWeekDays] = await Promise.all([
    deriveDayActuals(userId, reviewWeekStart, reviewWeekEnd),
    deriveDayActuals(userId, prevWeekStart, addDaysYmd(prevWeekStart, 6)),
  ]);

  const sumLoad = (days: Awaited<ReturnType<typeof deriveDayActuals>>) =>
    Object.values(days).reduce((s, d) => s + d.load, 0);
  const sumCount = (days: Awaited<ReturnType<typeof deriveDayActuals>>) =>
    Object.values(days).reduce((s, d) => s + d.count, 0);

  // ── Gather this week's data ────────────────────────────────────────────
  const [thisWeekMetrics] = await db
    .select({
      avgReadiness: avg(schema.dailyMetrics.readiness).mapWith(Number),
    })
    .from(schema.dailyMetrics)
    .where(
      and(
        eq(schema.dailyMetrics.userId, userId),
        gte(schema.dailyMetrics.date, reviewWeekStart),
        lte(schema.dailyMetrics.date, reviewWeekEnd)
      )
    );

  // ── Current CTL/ATL/TSB from latest wellness ───────────────────────────
  const latestWellness = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: desc(schema.wellnessDaily.date),
  });

  const weekLoad = sumLoad(thisWeekDays);
  const prevLoad = sumLoad(prevWeekDays);
  const sessions = sumCount(thisWeekDays);
  const prevSessions = sumCount(prevWeekDays);
  const avgReadiness = Math.round(thisWeekMetrics?.avgReadiness ?? 0);
  const ctl = Math.round(latestWellness?.ctl ?? 0);
  const atl = Math.round(latestWellness?.atl ?? 0);
  const tsb = ctl - atl;
  const delta =
    prevLoad > 0 ? Math.round(((weekLoad - prevLoad) / prevLoad) * 100) : 0;

  // CTL delta over the SAME calendar week as load, sessions and readiness —
  // all four are rendered in one sentence below and must mean one thing.
  const prevWellness = await db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      lte(schema.wellnessDaily.date, ctlBaselineYmd(reviewWeekStart))
    ),
    orderBy: desc(schema.wellnessDaily.date),
  });
  const ctlDelta = Math.round(
    (latestWellness?.ctl ?? 0) - (prevWellness?.ctl ?? 0)
  );

  // ── Plan adherence (read-only here; writes happen after the review is
  //    stored, so a crash can't advance the plan without a review) ─────────
  const activePlan = await getActivePlan(userId);

  const currentBlock = activePlan
    ? await db.query.trainingBlocks.findFirst({
        where: and(
          eq(schema.trainingBlocks.planId, activePlan.id),
          eq(schema.trainingBlocks.weekNumber, activePlan.currentWeek)
        ),
      })
    : null;

  // The just-reviewed week's own materialized row, if it has one — read
  // BEFORE rolloverWeekPlan runs below, so `activePlan.currentWeek` still
  // names the week this review is about, not the one it rolls into.
  const currentWeekPlan = activePlan
    ? await db.query.weekPlans.findFirst({
        where: and(
          eq(schema.weekPlans.planId, activePlan.id),
          eq(schema.weekPlans.skeletonWeek, activePlan.currentWeek)
        ),
        orderBy: desc(schema.weekPlans.weekStart),
      })
    : null;

  const planAdherence = currentBlock
    ? {
        weekNumber: currentBlock.weekNumber,
        targetLoad: (() => {
          const resolved = weekTargetLoad({
            effectiveTarget: currentWeekPlan?.effectiveTarget ?? null,
            blockTarget: currentBlock.targetLoadTotal,
          });
          return resolved.available ? resolved.value : 0;
        })(),
        actualLoad: weekLoad,
        adherencePct: weekAdherencePct({
          effectiveTarget: currentWeekPlan?.effectiveTarget ?? null,
          blockTarget: currentBlock.targetLoadTotal,
          actualLoad: weekLoad,
        }),
      }
    : null;

  // ── Generate review ────────────────────────────────────────────────────
  const templateText =
    `📊 Week in review: ${Math.round(weekLoad)} load across ${sessions} sessions ` +
    `(${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta)}% vs last week). ` +
    `Readiness averaged ${avgReadiness}. CTL ${ctl} (${ctlDelta >= 0 ? "+" : ""}${ctlDelta}).` +
    (planAdherence
      ? ` Plan week ${planAdherence.weekNumber}: ${planAdherence.adherencePct}% adherence.`
      : "");

  // v0.9.2 plan drift — quoted from the week's rollover adjustments (the
  // deterministic reasons carry the effective-vs-skeleton numbers); never
  // computed by the LLM.
  let driftLine = "";
  const { getOpenWeekPlan, listAdjustments } =
    await import("@/lib/week-plan/service");
  const openWeek = await getOpenWeekPlan(userId);
  if (openWeek) {
    const rolloverReasons = (await listAdjustments(openWeek.id))
      .filter((a) => a.trigger === "weekly_rollover")
      .map((a) => a.reason);
    driftLine =
      rolloverReasons.length > 0
        ? `Plan drift: this week's target was adjusted at rollover — ${rolloverReasons.join("; ")}\n`
        : "";
  }

  let text = templateText;
  try {
    const resolved = await resolveProvider(userId, "quick");
    if (resolved) {
      const instruction =
        `You are generating a weekly training review.\n\n` +
        `## This Week's Data\n` +
        `Total load: ${Math.round(weekLoad)} (last week: ${Math.round(prevLoad)}, delta: ${delta}%)\n` +
        `Sessions: ${sessions} (last week: ${prevSessions})\n` +
        `Avg readiness: ${avgReadiness}/100\n` +
        `CTL: ${ctl} (Δ ${ctlDelta}), ATL: ${atl}, TSB: ${tsb}\n` +
        (planAdherence
          ? `Plan adherence: ${planAdherence.adherencePct}% (target ${planAdherence.targetLoad}, actual ${planAdherence.actualLoad})\n`
          : "") +
        driftLine +
        `\n## Instructions\n` +
        `- Lead with the headline: bigger/smaller/recovery week\n` +
        `- Comment on readiness trend and recovery quality\n` +
        `- End with one actionable suggestion for next week\n` +
        `- Keep it to 3-4 sentences. Plain text only — no tool calls, no charts.`;

      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, userId),
      });
      const system = buildSystemPrompt({
        userName: user?.name ?? "the athlete",
        todayDate: todayYmd,
        personality: resolved.personality,
        language: resolved.language,
      });

      const res = await generateText({
        model: resolved.provider(resolved.model),
        system,
        prompt: languageDirective(instruction, resolved.language),
        abortSignal: AbortSignal.timeout(15_000),
      });
      const out = res.text;
      await recordLlmUsage({
        userId,
        model: resolved.model,
        slot: resolved.slot,
        purpose: "weekly",
        inputTokens: res.totalUsage?.inputTokens ?? res.usage?.inputTokens,
        outputTokens: res.totalUsage?.outputTokens ?? res.usage?.outputTokens,
      });
      if (out.trim()) text = out.trim();
    }
  } catch (err) {
    logger.warn("weekly review LLM failed — using template", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Store (assistant role so the thread UI renders it) ────────────────
  await db.insert(schema.chatMessages).values({
    threadId: thread.id,
    role: "assistant",
    content: text,
    toolCalls: {
      week: weekLabel,
      generated: text === templateText ? "template" : "llm",
    },
  });
  await db
    .update(schema.chatThreads)
    .set({ updatedAt: now })
    .where(eq(schema.chatThreads.id, thread.id));

  // Plan side-effects LAST: the stored review is the idempotency marker, so
  // a retry after a crash here can at worst redo these writes once.
  //
  // training_blocks actuals are deliberately NOT written here. rolloverWeekPlan
  // writes them below from bookWeekActuals/weekActuals — the plan-shaped
  // count of sessions completed, which is a different question from the
  // activity count this message reports. Two writers meant the review's
  // figure landed first and was silently overwritten; one writer means there
  // is nothing to diverge.
  if (activePlan && currentBlock && planAdherence) {
    await db
      .update(schema.trainingPlans)
      .set({ currentWeek: activePlan.currentWeek + 1 })
      .where(
        and(
          eq(schema.trainingPlans.id, activePlan.id),
          eq(schema.trainingPlans.currentWeek, activePlan.currentWeek)
        )
      );
  }

  // v0.9.2: the living week — close last week's plan, materialize this one.
  try {
    const { rolloverWeekPlan } = await import("@/lib/week-plan/service");
    await rolloverWeekPlan(userId);
  } catch (err) {
    logger.warn("week-plan rollover failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info("weekly review generated", {
    userId,
    weekLabel,
    sessions,
    weekLoad,
  });
}

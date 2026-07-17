/**
 * Weekly review generator — one proactive summary per user per review cycle,
 * written into the weekly thread (kind='weekly'). LLM-phrased when a provider
 * is configured, deterministic template otherwise. Never throws to callers.
 *
 * Scheduling: fires from the post-sync hook once the user's configured weekly
 * slot (day + hour, default Monday 04:00 — before the ~05:00 sync) has passed
 * and no review exists since that slot. Exact-hour matching would silently
 * never fire, because syncs run at SYNC_HOUR, not at the user's review hour.
 */
import { and, desc, eq, gte, lte, ne, count, avg, sum } from "drizzle-orm";
import { generateText } from "ai";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveProvider } from "@/lib/llm-provider";
import { buildSystemPrompt } from "@/lib/coach-persona";

export const WEEKLY_THREAD_TITLE = "Weekly Review";

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
  // Default hour sits BEFORE the daily sync hour so the review lands with
  // the Monday-morning sync; later hours land on the next sync after them.
  const reviewHour = prefs?.weeklyReviewHour ?? 4;
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
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const sevenAgoYmd = localYmd(sevenDaysAgo);
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

  // ── Gather this week's data ────────────────────────────────────────────
  const [thisWeekMetrics] = await db
    .select({
      avgReadiness: avg(schema.dailyMetrics.readiness).mapWith(Number),
    })
    .from(schema.dailyMetrics)
    .where(
      and(
        eq(schema.dailyMetrics.userId, userId),
        gte(schema.dailyMetrics.date, sevenAgoYmd),
        lte(schema.dailyMetrics.date, todayYmd)
      )
    );

  const [thisWeekLoad] = await db
    .select({
      totalLoad: sum(schema.activities.load).mapWith(Number),
      sessions: count(),
    })
    .from(schema.activities)
    .where(
      and(
        eq(schema.activities.userId, userId),
        ne(schema.activities.provider, "strava"),
        gte(schema.activities.startDate, sevenDaysAgo)
      )
    );

  // ── Gather prior week's data ───────────────────────────────────────────
  const [prevWeekLoad] = await db
    .select({
      totalLoad: sum(schema.activities.load).mapWith(Number),
      sessions: count(),
    })
    .from(schema.activities)
    .where(
      and(
        eq(schema.activities.userId, userId),
        ne(schema.activities.provider, "strava"),
        gte(schema.activities.startDate, fourteenDaysAgo),
        lte(schema.activities.startDate, sevenDaysAgo)
      )
    );

  // ── Current CTL/ATL/TSB from latest wellness ───────────────────────────
  const latestWellness = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: desc(schema.wellnessDaily.date),
  });

  const weekLoad = thisWeekLoad?.totalLoad ?? 0;
  const prevLoad = prevWeekLoad?.totalLoad ?? 0;
  const sessions = thisWeekLoad?.sessions ?? 0;
  const prevSessions = prevWeekLoad?.sessions ?? 0;
  const avgReadiness = Math.round(thisWeekMetrics?.avgReadiness ?? 0);
  const ctl = Math.round(latestWellness?.ctl ?? 0);
  const atl = Math.round(latestWellness?.atl ?? 0);
  const tsb = ctl - atl;
  const delta =
    prevLoad > 0 ? Math.round(((weekLoad - prevLoad) / prevLoad) * 100) : 0;

  // CTL delta: compare to what it was 7 days ago
  const prevWellness = await db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      lte(schema.wellnessDaily.date, sevenAgoYmd)
    ),
    orderBy: desc(schema.wellnessDaily.date),
  });
  const ctlDelta = Math.round(
    (latestWellness?.ctl ?? 0) - (prevWellness?.ctl ?? 0)
  );

  // ── Plan adherence (read-only here; writes happen after the review is
  //    stored, so a crash can't advance the plan without a review) ─────────
  const activePlan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, userId),
      eq(schema.trainingPlans.status, "active")
    ),
    orderBy: desc(schema.trainingPlans.createdAt),
  });

  const currentBlock = activePlan
    ? await db.query.trainingBlocks.findFirst({
        where: and(
          eq(schema.trainingBlocks.planId, activePlan.id),
          eq(schema.trainingBlocks.weekNumber, activePlan.currentWeek)
        ),
      })
    : null;

  const planAdherence = currentBlock
    ? {
        weekNumber: currentBlock.weekNumber,
        targetLoad: currentBlock.targetLoadTotal ?? 0,
        actualLoad: weekLoad,
        adherencePct: currentBlock.targetLoadTotal
          ? Math.round((weekLoad / currentBlock.targetLoadTotal) * 100)
          : 0,
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
      });

      const { text: out } = await generateText({
        model: resolved.provider(resolved.model),
        system,
        prompt: instruction,
        abortSignal: AbortSignal.timeout(15_000),
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

  // ── Plan side-effects LAST: the stored review is the idempotency marker,
  //    so a retry after a crash here can at worst redo these writes once ──
  if (activePlan && currentBlock && planAdherence) {
    await db
      .update(schema.trainingBlocks)
      .set({
        actualLoad: weekLoad,
        actualSessions: sessions,
        adherencePct: planAdherence.adherencePct,
      })
      .where(eq(schema.trainingBlocks.id, currentBlock.id));
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

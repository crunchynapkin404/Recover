/**
 * Weekly review generator — one proactive summary per user per ISO week,
 * written into a system thread (kind='weekly'). LLM-phrased when a provider
 * is configured, deterministic template otherwise. Never throws to callers.
 */
import { and, desc, eq, gte, lte, sql, count, avg, sum } from "drizzle-orm";
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

async function findOrCreateWeeklyThread(userId: string) {
  const existing = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.userId, userId),
      eq(schema.chatThreads.kind, "weekly"),
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
  const msg = await db.query.chatMessages.findFirst({
    where: and(
      eq(schema.chatMessages.threadId, thread.id),
      eq(schema.chatMessages.role, "system")
    ),
    orderBy: [desc(schema.chatMessages.createdAt)],
  });
  if (!msg) return null;
  return { text: msg.content, threadId: thread.id, createdAt: msg.createdAt };
}

export async function generateWeeklyReview(userId: string): Promise<void> {
  const now = new Date();

  // ── Day/hour guard — only run at user's configured review time ─────────
  const prefs = await db.query.notificationPrefs.findFirst({
    where: eq(schema.notificationPrefs.userId, userId),
  });
  const dayOfWeek = now.getDay(); // 0=Sun
  const hour = now.getHours();
  const reviewDay = prefs?.weeklyReviewDay ?? 1; // default Monday
  const reviewHour = prefs?.weeklyReviewHour ?? 7; // default 7am
  if (dayOfWeek !== reviewDay || hour !== reviewHour) return;

  const weekLabel = isoWeekLabel(now);

  // ── At-most-once guard ─────────────────────────────────────────────────
  const thread = await findOrCreateWeeklyThread(userId);
  const latest = await db.query.chatMessages.findFirst({
    where: eq(schema.chatMessages.threadId, thread.id),
    orderBy: desc(schema.chatMessages.createdAt),
  });
  if (latest) {
    const meta = (latest.toolCalls ?? {}) as { week?: string };
    if (meta.week === weekLabel) {
      logger.info("weekly review already exists for this week", { userId, weekLabel });
      return;
    }
  }

  // ── Skip if insufficient data ──────────────────────────────────────────
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const sevenAgoYmd = localYmd(sevenDaysAgo);
  const fourteenAgoYmd = localYmd(fourteenDaysAgo);
  const todayYmd = localYmd(now);

  const [activityCount] = await db
    .select({ n: count() })
    .from(schema.activities)
    .where(
      and(
        eq(schema.activities.userId, userId),
        gte(schema.activities.startDate, sevenDaysAgo),
      ),
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
      totalLoad: sum(schema.dailyMetrics.tsb).mapWith(Number), // placeholder; use activities
      avgReadiness: avg(schema.dailyMetrics.readiness).mapWith(Number),
    })
    .from(schema.dailyMetrics)
    .where(
      and(
        eq(schema.dailyMetrics.userId, userId),
        gte(schema.dailyMetrics.date, sevenAgoYmd),
        lte(schema.dailyMetrics.date, todayYmd),
      ),
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
        gte(schema.activities.startDate, sevenDaysAgo),
      ),
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
        gte(schema.activities.startDate, fourteenDaysAgo),
        lte(schema.activities.startDate, sevenDaysAgo),
      ),
    );

  const [prevWeekMetrics] = await db
    .select({
      avgReadiness: avg(schema.dailyMetrics.readiness).mapWith(Number),
    })
    .from(schema.dailyMetrics)
    .where(
      and(
        eq(schema.dailyMetrics.userId, userId),
        gte(schema.dailyMetrics.date, fourteenAgoYmd),
        lte(schema.dailyMetrics.date, sevenAgoYmd),
      ),
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
  const delta = prevLoad > 0 ? Math.round(((weekLoad - prevLoad) / prevLoad) * 100) : 0;

  // CTL delta: compare to what it was 7 days ago
  const prevWellness = await db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      lte(schema.wellnessDaily.date, sevenAgoYmd),
    ),
    orderBy: desc(schema.wellnessDaily.date),
  });
  const ctlDelta = Math.round((latestWellness?.ctl ?? 0) - (prevWellness?.ctl ?? 0));

  // ── Generate review ────────────────────────────────────────────────────
  const templateText =
    `📊 Week in review: ${Math.round(weekLoad)} load across ${sessions} sessions ` +
    `(${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta)}% vs last week). ` +
    `Readiness averaged ${avgReadiness}. CTL ${ctl} (${ctlDelta >= 0 ? "+" : ""}${ctlDelta}).`;

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
        `CTL: ${ctl} (Δ ${ctlDelta}), ATL: ${atl}, TSB: ${tsb}\n\n` +
        `## Instructions\n` +
        `- Lead with the headline: bigger/smaller/recovery week\n` +
        `- Use render_chart with type "bar", title "Daily Load", one series with each day's load\n` +
        `- Comment on readiness trend and recovery quality\n` +
        `- End with one actionable suggestion for next week\n` +
        `- Keep it to 3-4 sentences + the chart`;

      const [user] = await Promise.all([
        db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      ]);
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

  // ── Store ──────────────────────────────────────────────────────────────
  await db.insert(schema.chatMessages).values({
    threadId: thread.id,
    role: "system",
    content: text,
    toolCalls: { week: weekLabel, generated: text === templateText ? "template" : "llm" },
  });
  await db
    .update(schema.chatThreads)
    .set({ updatedAt: now })
    .where(eq(schema.chatThreads.id, thread.id));

  logger.info("weekly review generated", { userId, weekLabel, sessions, weekLoad });
}

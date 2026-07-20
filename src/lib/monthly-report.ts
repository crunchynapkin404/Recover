/**
 * v0.15 monthly report — the weekly review's big sibling. One report per
 * user per calendar month, covering the month that just ended. All content
 * comes from existing engines; sections with no data are OMITTED, never
 * padded (a manual athlete without biomarkers gets a shorter report, not an
 * interpolated one). Strava rows are excluded from every aggregate (AI
 * firewall). No push — a monthly report can wait for the next visit.
 */
import { and, avg, count, desc, eq, gte, lt, ne, sum } from "drizzle-orm";
import { generateText } from "ai";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveProvider } from "@/lib/llm-provider";
import { buildSystemPrompt } from "@/lib/coach-persona";
import { getMilestones } from "@/lib/insights/milestones";
import { recordLlmUsage } from "@/lib/llm-usage";

export const MONTHLY_THREAD_TITLE = "Monthly Report";
const MIN_SESSIONS = 4;

/** 1st of the current month at reviewHour; if that's still ahead of `now`,
 * the 1st of the previous month. Same due-since philosophy as the weekly
 * slot: a sleeping server delivers late, never never. */
export function mostRecentMonthlySlot(now: Date, reviewHour: number): Date {
  const slot = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    reviewHour,
    0,
    0,
    0
  );
  if (slot > now)
    return new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
      reviewHour,
      0,
      0,
      0
    );
  return slot;
}

function monthLabel(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function findOrCreateMonthlyThread(userId: string) {
  const existing = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.userId, userId),
      eq(schema.chatThreads.kind, "monthly")
    ),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(schema.chatThreads)
    .values({ userId, title: MONTHLY_THREAD_TITLE, kind: "monthly" })
    .returning();
  return created;
}

async function loadForRange(userId: string, from: Date, to: Date) {
  const [row] = await db
    .select({
      totalLoad: sum(schema.activities.load).mapWith(Number),
      sessions: count(),
    })
    .from(schema.activities)
    .where(
      and(
        eq(schema.activities.userId, userId),
        ne(schema.activities.provider, "strava"),
        gte(schema.activities.startDate, from),
        lt(schema.activities.startDate, to)
      )
    );
  return { totalLoad: row?.totalLoad ?? 0, sessions: row?.sessions ?? 0 };
}

export async function generateMonthlyReport(
  userId: string,
  opts?: { now?: Date; llm?: (prompt: string) => Promise<string> }
): Promise<void> {
  const now = opts?.now ?? new Date();

  // ── Due-since-slot guard ────────────────────────────────────────────────
  const prefs = await db.query.notificationPrefs.findFirst({
    where: eq(schema.notificationPrefs.userId, userId),
  });
  const reviewHour = prefs?.weeklyReviewHour ?? 4;
  const slot = mostRecentMonthlySlot(now, reviewHour);

  // ── At-most-once-per-cycle guard ───────────────────────────────────────
  const thread = await findOrCreateMonthlyThread(userId);
  const latest = await db.query.chatMessages.findFirst({
    where: eq(schema.chatMessages.threadId, thread.id),
    orderBy: desc(schema.chatMessages.createdAt),
  });
  if (latest && latest.createdAt >= slot) return; // already reported this cycle

  // Report month = the calendar month before the slot's month.
  const monthStart = new Date(slot.getFullYear(), slot.getMonth() - 1, 1);
  const monthEnd = new Date(slot.getFullYear(), slot.getMonth(), 1);
  const prevStart = new Date(slot.getFullYear(), slot.getMonth() - 2, 1);
  const label = monthLabel(monthStart);

  // ── Skip if insufficient data ──────────────────────────────────────────
  const month = await loadForRange(userId, monthStart, monthEnd);
  if (month.sessions < MIN_SESSIONS) {
    logger.info("monthly report skipped — insufficient sessions", {
      userId,
      sessions: month.sessions,
    });
    return;
  }
  const prev = await loadForRange(userId, prevStart, monthStart);

  const lines: string[] = [
    `Load: ${Math.round(month.totalLoad)} across ${month.sessions} sessions` +
      (prev.sessions > 0
        ? ` (previous month: ${Math.round(prev.totalLoad)} across ${prev.sessions}).`
        : `.`),
  ];

  // Readiness distribution for the month (omit when empty).
  const [readiness] = await db
    .select({
      avgReadiness: avg(schema.dailyMetrics.readiness).mapWith(Number),
      days: count(),
    })
    .from(schema.dailyMetrics)
    .where(
      and(
        eq(schema.dailyMetrics.userId, userId),
        gte(schema.dailyMetrics.date, localYmd(monthStart)),
        lt(schema.dailyMetrics.date, localYmd(monthEnd))
      )
    );
  if ((readiness?.days ?? 0) > 0 && readiness?.avgReadiness != null) {
    lines.push(
      `Readiness averaged ${Math.round(readiness.avgReadiness)} over ${readiness.days} scored days.`
    );
  }

  // Milestones (existing engine — already honest about streaks). Actual
  // shape per src/lib/insights/milestones.ts's Milestones interface:
  // { currentStreak, bestStreak, planWeeksCompleted, plansCompleted } — all
  // plain numbers, computed fresh on read (nothing persisted). Each part is
  // omitted individually when zero; the whole line is omitted when nothing
  // qualifies.
  try {
    const milestones = await getMilestones(userId, now);
    const parts: string[] = [];
    if (milestones.currentStreak > 0) {
      parts.push(
        milestones.bestStreak > milestones.currentStreak
          ? `${milestones.currentStreak}-day journaling streak (best ${milestones.bestStreak})`
          : `${milestones.currentStreak}-day journaling streak`
      );
    } else if (milestones.bestStreak > 0) {
      parts.push(`best journaling streak ${milestones.bestStreak} days`);
    }
    if (milestones.planWeeksCompleted > 0) {
      parts.push(`${milestones.planWeeksCompleted} plan weeks completed`);
    }
    if (milestones.plansCompleted > 0) {
      parts.push(`${milestones.plansCompleted} training plans completed`);
    }
    if (parts.length > 0) lines.push(`Milestones: ${parts.join(", ")}.`);
  } catch {
    // milestones are optional decoration; absence is silence, not filler
  }

  // Biomarkers logged this month (deltas belong to /health; here just the fact).
  const [bio] = await db
    .select({ n: count() })
    .from(schema.biomarkers)
    .where(
      and(
        eq(schema.biomarkers.userId, userId),
        gte(schema.biomarkers.createdAt, monthStart),
        lt(schema.biomarkers.createdAt, monthEnd)
      )
    );
  if ((bio?.n ?? 0) > 0)
    lines.push(
      `${bio!.n} biomarker values were logged — see /health for trends.`
    );

  // Races decided this month.
  const races = await db.query.races.findMany({
    where: eq(schema.races.userId, userId),
  });
  const monthRaces = races.filter(
    (r) => r.date >= localYmd(monthStart) && r.date < localYmd(monthEnd)
  );
  if (monthRaces.length > 0) {
    lines.push(
      `Races: ${monthRaces.map((r) => `${r.name} (${r.status})`).join(", ")}.`
    );
  }

  const template = `📅 ${label} in review: ${lines.join(" ")}`;

  let text = template;
  try {
    if (opts?.llm) {
      const out = (await opts.llm(template)).trim();
      if (out) text = out;
    } else {
      const resolved = await resolveProvider(userId, "quick");
      if (resolved) {
        const user = await db.query.users.findFirst({
          where: eq(schema.users.id, userId),
        });
        const system = buildSystemPrompt({
          userName: user?.name ?? "the athlete",
          todayDate: localYmd(now),
          personality: resolved.personality,
        });
        const instruction =
          `You are writing the athlete's monthly training report for ${label}.\n\n` +
          `## Data (everything you may cite — never invent numbers)\n${lines.join("\n")}\n\n` +
          `## Instructions\n- Lead with the month's headline (bigger/smaller/steady).\n` +
          `- Note the readiness trend if given.\n- Celebrate milestones the data supports.\n` +
          `- Close with one focus for next month.\n- 5-7 sentences, plain text, no tool calls.`;
        const res = await generateText({
          model: resolved.provider(resolved.model),
          system,
          prompt: instruction,
          abortSignal: AbortSignal.timeout(15_000),
        });
        await recordLlmUsage({
          userId,
          model: resolved.model,
          slot: resolved.slot,
          purpose: "monthly",
          inputTokens: res.totalUsage?.inputTokens ?? res.usage?.inputTokens,
          outputTokens: res.totalUsage?.outputTokens ?? res.usage?.outputTokens,
        });
        if (res.text.trim()) text = res.text.trim();
      }
    }
  } catch (err) {
    logger.warn("monthly report LLM failed — using template", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  await db.insert(schema.chatMessages).values({
    threadId: thread.id,
    role: "assistant",
    content: text,
    toolCalls: {
      month: label,
      generated: text === template ? "template" : "llm",
    },
  });
  await db
    .update(schema.chatThreads)
    .set({ updatedAt: now })
    .where(eq(schema.chatThreads.id, thread.id));
  logger.info("monthly report generated", { userId, month: label });
}

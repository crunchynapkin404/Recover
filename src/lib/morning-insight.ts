/**
 * Morning coach insight — one proactive assistant message per user per day,
 * written into a system thread (kind='morning') after the overnight sync.
 * LLM-phrased when a provider is configured (10s cap), deterministic
 * template otherwise. Never throws to callers in the sync path.
 */
import { and, desc, eq } from "drizzle-orm";
import { generateText } from "ai";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveProvider } from "@/lib/llm-provider";
import { buildSystemPrompt } from "@/lib/coach-persona";
import { fetchAthleteContext } from "@/lib/coach-context";
import {
  getOvertrainingStatus,
  type OvertrainingSignal,
} from "@/lib/overtraining";

export const MORNING_THREAD_TITLE = "Morning coach";

export interface MorningInsight {
  text: string;
  warning: OvertrainingSignal | null;
  threadId: string;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const BAND_LINES: Record<string, string> = {
  green: "Green light — good day for intensity.",
  amber: "Moderate — keep quality controlled.",
  red: "Recovery day — keep it easy.",
};

function warningSentence(warning: OvertrainingSignal): string {
  return warning.kind === "hrv_suppression"
    ? `Heads up: HRV has been suppressed ${warning.sinceDays} days running — consider easing off and prioritizing sleep.`
    : `Heads up: resting HR has been well above baseline for ${warning.sinceDays} days — watch for illness or accumulated fatigue.`;
}

async function findOrCreateMorningThread(userId: string) {
  const existing = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.userId, userId),
      eq(schema.chatThreads.kind, "morning")
    ),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(schema.chatThreads)
    .values({ userId, title: MORNING_THREAD_TITLE, kind: "morning" })
    .returning();
  return created;
}

export async function generateMorningInsight(
  userId: string,
  opts?: { now?: Date; llm?: (prompt: string) => Promise<string> }
): Promise<MorningInsight | "skipped"> {
  const now = opts?.now ?? new Date();
  const today = localYmd(now);

  const metric = await db.query.dailyMetrics.findFirst({
    where: and(
      eq(schema.dailyMetrics.userId, userId),
      eq(schema.dailyMetrics.date, today)
    ),
  });
  if (!metric || metric.readiness == null || metric.band === "calibrating") {
    return "skipped";
  }

  const thread = await findOrCreateMorningThread(userId);
  const latest = await db.query.chatMessages.findFirst({
    where: eq(schema.chatMessages.threadId, thread.id),
    orderBy: desc(schema.chatMessages.createdAt),
  });
  if (latest && localYmd(latest.createdAt) === today) return "skipped";

  const warning = await getOvertrainingStatus(userId);

  // v0.9.2: today's plan adjustments — quoted verbatim, never invented.
  let adjustmentReasons: string[] = [];
  const { getOpenWeekPlan, listAdjustments } =
    await import("@/lib/week-plan/service");
  const weekPlan = await getOpenWeekPlan(userId);
  if (weekPlan) {
    adjustmentReasons = (await listAdjustments(weekPlan.id))
      .filter((a) => a.date === today)
      .map((a) => a.reason);
  }

  const template =
    [
      `Readiness ${Math.round(metric.readiness)} (${metric.band}).` +
        (metric.tsb != null ? ` TSB ${Math.round(metric.tsb)}.` : ""),
      warning
        ? warningSentence(warning)
        : (BAND_LINES[metric.band ?? ""] ?? ""),
    ]
      .filter(Boolean)
      .join(" ") +
    (adjustmentReasons.length > 0
      ? ` Plan: ${adjustmentReasons.join("; ")}.`
      : "");

  const instruction =
    `Write this morning's proactive check-in for the athlete (max 120 words, no greeting fluff). ` +
    `Today: readiness ${Math.round(metric.readiness)}, band ${metric.band}` +
    (metric.tsb != null ? `, TSB ${Math.round(metric.tsb)}` : "") +
    `. ` +
    (warning
      ? `LEAD with this warning and make it unmissable: ${warningSentence(warning)} `
      : "") +
    (adjustmentReasons.length > 0
      ? `Plan adjustments this morning: ${adjustmentReasons.join("; ")}. ` +
        `Mention what changed in the plan and why — quote the given reasons, do not invent adjustments. `
      : "") +
    `End with one concrete suggestion for today.`;

  let text = template;
  let generated: "llm" | "template" = "template";
  try {
    if (opts?.llm) {
      const out = (await opts.llm(instruction)).trim();
      if (out) {
        text = out;
        generated = "llm";
      }
    } else {
      const resolved = await resolveProvider(userId, "quick");
      if (resolved) {
        const [user, context] = await Promise.all([
          db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
          fetchAthleteContext(userId, db),
        ]);
        const system =
          buildSystemPrompt({
            userName: user?.name ?? "the athlete",
            todayDate: today,
            personality: resolved.personality,
          }) + `\n\n${context}`;
        const { text: out } = await generateText({
          model: resolved.provider(resolved.model),
          system,
          prompt: instruction,
          abortSignal: AbortSignal.timeout(10_000),
        });
        if (out.trim()) {
          text = out.trim();
          generated = "llm";
        }
      }
    }
  } catch (err) {
    logger.warn("morning insight LLM failed — using template", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  await db.insert(schema.chatMessages).values({
    threadId: thread.id,
    role: "assistant",
    content: text,
    toolCalls: { generated, warning: warning?.kind ?? null },
  });
  await db
    .update(schema.chatThreads)
    .set({ updatedAt: now })
    .where(eq(schema.chatThreads.id, thread.id));

  return { text, warning, threadId: thread.id };
}

export async function getLatestMorningInsight(
  userId: string,
  now: Date = new Date()
): Promise<{
  text: string;
  warning: string | null;
  threadId: string;
  createdAt: Date;
} | null> {
  const thread = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.userId, userId),
      eq(schema.chatThreads.kind, "morning")
    ),
  });
  if (!thread) return null;
  const latest = await db.query.chatMessages.findFirst({
    where: eq(schema.chatMessages.threadId, thread.id),
    orderBy: desc(schema.chatMessages.createdAt),
  });
  if (!latest || localYmd(latest.createdAt) !== localYmd(now)) return null;
  const meta = (latest.toolCalls ?? {}) as { warning?: string | null };
  return {
    text: latest.content,
    warning: meta.warning ?? null,
    threadId: thread.id,
    createdAt: latest.createdAt,
  };
}

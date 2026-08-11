/**
 * Morning coach insight — one proactive assistant message per user per day,
 * written into a system thread (kind='morning') after the overnight sync.
 * LLM-phrased when a provider is configured (10s cap), deterministic
 * template otherwise. Never throws to callers in the sync path.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { generateText } from "ai";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveProvider } from "@/lib/llm-provider";
import { recordLlmUsage } from "@/lib/llm-usage";
import { buildSystemPrompt, languageDirective } from "@/lib/coach-persona";
import { fetchAthleteContext } from "@/lib/coach-context";
import { calibrationProgress } from "@/lib/calibration";
import { advanceLoadEma } from "@/lib/training-load";
import { unavailableMessage } from "@/components/ui/unavailable";
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

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localYmd(d);
}

/**
 * Post-race debriefs (src/lib/race/debrief.ts's postDebrief) also land in the
 * morning thread. They must never count as "today's morning insight" for the
 * at-most-once guard or the dashboard card — a debrief landing first (e.g. a
 * post-midnight sync tick) would otherwise silently eat the athlete's real
 * morning check-in for the day.
 */
function isRaceDebriefMessage(msg: { toolCalls: unknown }): boolean {
  const meta = (msg.toolCalls ?? {}) as { kind?: string };
  return meta.kind === "race_debrief";
}

/**
 * The 10 most recent messages in the thread, newest first. This window backs
 * the plain same-day guard (`latest`, any role) and the dashboard card
 * (`latestNonDebriefMessage`) — both only ever care about the newest one or
 * two messages, so 10 is generous headroom for those. It does NOT govern the
 * revision target: the morning thread is a live conversational thread, and a
 * busy day can carry today's brief (posted first, ~05:00) past this window
 * long before the day is over — todaysBrief() below queries for that
 * directly rather than scanning this page.
 */
async function recentMessages(threadId: string) {
  return db.query.chatMessages.findMany({
    where: eq(schema.chatMessages.threadId, threadId),
    orderBy: desc(schema.chatMessages.createdAt),
    limit: 10,
  });
}

/** Most recent message in the thread that is not a race debrief. */
async function latestNonDebriefMessage(threadId: string) {
  const recent = await recentMessages(threadId);
  return recent.find((m) => !isRaceDebriefMessage(m)) ?? null;
}

/**
 * Today's morning brief, if one exists — the sole valid revision target.
 * Deliberately distinct from "latest message" (used by the same-day skip
 * guard, which must fire on any same-day message including a user reply)
 * and from "latest non-debrief message" (used unchanged by
 * getLatestMorningInsight for the dashboard card).
 *
 * Queried directly rather than scanned out of recentMessages()'s 10-row
 * page: the morning thread is a live conversational thread (athlete replies,
 * race debriefs), not an append-only feed, and today's brief — posted first,
 * ~05:00 — can fall out of a 10-row window well before the day is over on a
 * chatty day. Since this is now the sole path to the revision target, that
 * window being wrong here means the revision silently stops firing.
 *
 * The "is a brief" filter — role='assistant', not a race debrief, carries a
 * `generated` key in toolCalls (mirroring isRaceDebriefMessage's logic; race
 * debriefs also set `generated`, so they must be excluded explicitly rather
 * than relying on the key's mere presence) — is applied in SQL rather than
 * in code on a single fetched row: if we instead fetched only the newest
 * assistant message of the day and then filtered it in code, a race debrief
 * landing after the real brief (e.g. a post-midnight sync tick) would be the
 * newest row, fail the filter, and hide an older real brief that's still
 * sitting there waiting to be revised. Filtering in SQL lets the database
 * find the newest row that actually satisfies "is a brief," skipping over
 * any race debrief in between.
 */
async function todaysBrief(threadId: string, now: Date) {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const row = await db.query.chatMessages.findFirst({
    where: and(
      eq(schema.chatMessages.threadId, threadId),
      eq(schema.chatMessages.role, "assistant"),
      gte(schema.chatMessages.createdAt, startOfToday),
      // Has a `generated` key in toolCalls (jsonb key-existence operator)...
      sql`${schema.chatMessages.toolCalls} ? 'generated'`,
      // ...and is not a race debrief (which also sets `generated`).
      sql`(${schema.chatMessages.toolCalls} ->> 'kind') IS DISTINCT FROM 'race_debrief'`
    ),
    orderBy: desc(schema.chatMessages.createdAt),
  });
  return row ?? null;
}

export async function findOrCreateMorningThread(userId: string) {
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
  opts?: {
    now?: Date;
    llm?: (prompt: string) => Promise<string>;
    force?: boolean;
  }
): Promise<MorningInsight | "skipped"> {
  const now = opts?.now ?? new Date();
  const today = localYmd(now);

  // Task 12: a race today keeps the brief alive even while readiness is
  // still calibrating — non-race days are unaffected below.
  const raceToday = await db.query.races.findFirst({
    where: and(
      eq(schema.races.userId, userId),
      eq(schema.races.date, today),
      eq(schema.races.status, "upcoming")
    ),
  });

  const metric = await db.query.dailyMetrics.findFirst({
    where: and(
      eq(schema.dailyMetrics.userId, userId),
      eq(schema.dailyMetrics.date, today)
    ),
  });
  const calibrating =
    !metric || metric.readiness == null || metric.band === "calibrating";
  // 09:00 backstop (event-driven sync triggers, 2026-07-26): force bypasses
  // the "not enough data yet" gate so the athlete still gets a brief today,
  // using the same honest "calibrating" degraded text the race branch
  // already produces when readiness is missing.
  if (calibrating && !raceToday && !opts?.force) {
    return "skipped";
  }

  // Completeness (2026-07-26): the gate in wellness-changed.ts already held
  // the non-forced path until last night's HRV and sleep arrived, so a
  // brief reaching this point without them is a forced/backstop one. Say so
  // rather than presenting a partial number as whole.
  const { arrivalFromWellness, overnightComplete, gapSentence } =
    await import("@/lib/brief-completeness");
  // Fail closed: if we can't confirm what arrived, treat it as absent rather
  // than silently presenting a possibly-partial number as complete — a
  // transient DB error should produce an honest, caveated brief, not one
  // that claims complete data it never confirmed.
  let wellnessToday: typeof schema.wellnessDaily.$inferSelect | undefined;
  try {
    wellnessToday = await db.query.wellnessDaily.findFirst({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        eq(schema.wellnessDaily.date, today)
      ),
    });
  } catch (err) {
    logger.error("completeness read failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
    wellnessToday = undefined;
  }
  const arrival = arrivalFromWellness(wellnessToday);
  const dataComplete = overnightComplete(arrival);
  const caveat = dataComplete
    ? null
    : gapSentence(metric?.componentScores, arrival);

  const thread = await findOrCreateMorningThread(userId);
  const recent = await recentMessages(thread.id);
  const latest = recent.find((m) => !isRaceDebriefMessage(m)) ?? null;

  // At-most-once per day, with exactly one exception: a brief that admitted
  // to being incomplete may be replaced once the real overnight data lands.
  // This check MUST come before the plain same-day guard — that guard
  // returns early on any same-day message and would otherwise make the
  // revision path unreachable.
  //
  // The same-day guard itself still keys off `latest` (the newest message of
  // any role) — a same-day reply from the athlete must go on suppressing a
  // brand-new brief exactly as it always has. But the revision *target* must
  // be today's actual brief, not whatever message happens to be newest: if
  // the athlete replies to an incomplete brief before the real data lands,
  // `latest` is that reply (toolCalls null), and keying revision off it would
  // silently give up on ever correcting the brief.
  let revising: { id: string } | null = null;
  if (latest && localYmd(latest.createdAt) === today) {
    const brief = await todaysBrief(thread.id, now);
    const meta = (brief?.toolCalls ?? {}) as { dataComplete?: boolean };
    const revisable = brief != null && meta.dataComplete === false;
    if (!revisable || !dataComplete) return "skipped";
    revising = { id: brief.id };
  }

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

  // Task 12: race-day projected-vs-actual TSB — a pure EMA decay step from
  // yesterday's stored ctl/atl, vs today's actual stored TSB. Yesterday's
  // stored ctl/atl already includes yesterday's session (house EMA
  // convention — see training-load.ts's walk), so projecting today's
  // pre-session form is decay only; adding yesterday's load again would
  // double-count it. Omitted when yesterday's row is missing ctl/atl.
  let projectedLine = "";
  if (raceToday) {
    const yesterday = addDaysYmd(today, -1);
    const yRow = await db.query.dailyMetrics.findFirst({
      where: and(
        eq(schema.dailyMetrics.userId, userId),
        eq(schema.dailyMetrics.date, yesterday)
      ),
    });
    if (yRow?.ctl != null && yRow.atl != null) {
      const { ctl: pCtl, atl: pAtl } = advanceLoadEma(
        { ctl: yRow.ctl, atl: yRow.atl },
        0
      );
      const projected = Math.round((pCtl - pAtl) * 10) / 10;
      projectedLine =
        metric?.tsb != null
          ? `Projected TSB ${projected} vs actual ${Math.round(metric.tsb * 10) / 10}. `
          : `Projected TSB ${projected}. `;
    }
  }

  // Fix (race-day caveat ordering): the caveat belongs after the race
  // lead-in, not ahead of it — race day is the highest-stakes brief of the
  // athlete's season and "lead with the race" must actually be true of the
  // rendered text. Woven in here (rather than prepended outside, as the
  // non-race branch does below) so it lands right after "Race day: <name>
  // (<priority> race)." and before the physiological-state line.
  // Readiness null covers two different situations: genuine first-run
  // calibration, or an already-calibrated athlete with no HRV/RHR reading
  // today (same distinction the Estimated Energy card's v0.70.0 fix made).
  // 90 days, not just the 14-day target, matching Today hero's and Body
  // Battery's own calibrationProgress() callers (page.tsx, body/page.tsx) —
  // a narrower window would undercount an already-calibrated athlete who
  // has an ordinary gap somewhere in the trailing two weeks. Fail closed on
  // a query error, same reasoning as wellnessToday above: a forced backstop
  // brief must still post rather than throw.
  let readinessWindow: (typeof schema.wellnessDaily.$inferSelect)[] = [];
  try {
    readinessWindow = await db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        gte(schema.wellnessDaily.date, addDaysYmd(today, -90))
      ),
    });
  } catch (err) {
    logger.error("readiness-calibration read failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  const readinessCalibration = calibrationProgress(
    readinessWindow.map((w) => ({
      hrvMs: w.hrvMs,
      restingHr: w.restingHr,
      hrvSdnnMs: w.hrvSdnnMs,
    }))
  );
  const readinessGap = unavailableMessage(
    readinessCalibration.remaining > 0
      ? {
          kind: "calibrating",
          have: readinessCalibration.daysWithSignal,
          need: readinessCalibration.target,
          unit: "days",
        }
      : { kind: "missing_input", needs: "a readiness score today" }
  );

  const raceTemplate = raceToday
    ? `Race day: ${raceToday.name} (${raceToday.priority} race). ` +
      (caveat ? `${caveat} ` : "") +
      (metric?.readiness != null
        ? `Readiness ${Math.round(metric.readiness)} (${metric.band}). `
        : `Readiness: ${readinessGap} — trust your taper. `) +
      projectedLine +
      (raceToday.goalNote ? `Goal: ${raceToday.goalNote}.` : "")
    : null;

  // Fix (redundant caveat): when there's no race and readiness itself is
  // null, the template body already names the gap — the completeness
  // caveat would just repeat that same fact in different words. The race
  // branch's "trust your taper" line doesn't duplicate the caveat the same
  // way, so it's untouched above.
  const calibratingNoRace = !raceToday && metric?.readiness == null;

  const templateBody =
    raceTemplate ??
    [
      metric?.readiness != null
        ? `Readiness ${Math.round(metric.readiness)} (${metric.band}).` +
          (metric.tsb != null ? ` TSB ${Math.round(metric.tsb)}.` : "")
        : `${readinessGap}.`,
      warning
        ? warningSentence(warning)
        : (BAND_LINES[metric?.band ?? ""] ?? ""),
    ]
      .filter(Boolean)
      .join(" ") +
      (adjustmentReasons.length > 0
        ? ` Plan: ${adjustmentReasons.join("; ")}.`
        : "");

  // Race day: the caveat (if any) is already woven into raceTemplate above,
  // so templateBody must not be prefixed again here.
  const template = raceToday
    ? templateBody
    : caveat && !calibratingNoRace
      ? `${caveat} ${templateBody}`
      : templateBody;

  const raceInstruction = raceToday
    ? `Today is race day: ${raceToday.name} (priority ${raceToday.priority}).` +
      (raceToday.goalNote
        ? ` The athlete's goal: ${raceToday.goalNote}.`
        : "") +
      ` Write a race-morning brief (max 150 words): lead with the race, ` +
      `one line on physiological state (${
        metric?.readiness != null
          ? `readiness ${Math.round(metric.readiness)}, band ${metric.band}`
          : "readiness calibrating — do not invent a number"
      }), ` +
      projectedLine +
      `one concrete execution reminder tied to the goal. No generic training advice, no workout suggestions.`
    : null;

  const instructionBody =
    raceInstruction ??
    `Write this morning's proactive check-in for the athlete (max 120 words, no greeting fluff). ` +
      `Today: ` +
      (metric?.readiness != null
        ? `readiness ${Math.round(metric.readiness)}, band ${metric.band}` +
          (metric.tsb != null ? `, TSB ${Math.round(metric.tsb)}` : "")
        : `readiness still calibrating — not enough data today, do not invent a number`) +
      `. ` +
      (warning
        ? `LEAD with this warning and make it unmissable: ${warningSentence(warning)} `
        : "") +
      (adjustmentReasons.length > 0
        ? `Plan adjustments this morning: ${adjustmentReasons.join("; ")}. ` +
          `Mention what changed in the plan and why — quote the given reasons, do not invent adjustments. `
        : "") +
      `End with one concrete suggestion for today.`;

  // Race day keeps the caveat (honesty principle) but must not contradict
  // the race branch's own "lead with the race" instruction above — so the
  // race phrasing asks the LLM to place the limitation after the race
  // lead-in rather than to open with it. The non-race phrasing is unchanged.
  // Suppressed entirely when the instruction body already says readiness is
  // still calibrating (Fix: redundant caveat) — see calibratingNoRace above.
  const instruction =
    caveat && !calibratingNoRace
      ? `${instructionBody} IMPORTANT — the data is incomplete: ${caveat} ${
          raceToday
            ? "Mention this limitation after the race lead-in; do not present the readiness number as a complete picture."
            : "Open with that limitation in your own words; do not present the readiness number as a complete picture."
        }`
      : instructionBody;

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
            language: resolved.language,
          }) + `\n\n${context}`;
        const res = await generateText({
          model: resolved.provider(resolved.model),
          system,
          prompt: languageDirective(instruction, resolved.language),
          abortSignal: AbortSignal.timeout(10_000),
        });
        const out = res.text;
        await recordLlmUsage({
          userId,
          model: resolved.model,
          slot: resolved.slot,
          purpose: "morning",
          inputTokens: res.totalUsage?.inputTokens ?? res.usage?.inputTokens,
          outputTokens: res.totalUsage?.outputTokens ?? res.usage?.outputTokens,
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

  const meta = {
    generated,
    warning: warning?.kind ?? null,
    forced: opts?.force ?? false,
    dataComplete,
  };
  if (revising) {
    // UPDATE, not a second INSERT: the thread keeps exactly one brief per
    // day and the dashboard card (which reads the latest non-debrief
    // message) needs no change. chat_messages.search is a generated column
    // and refreshes itself from the new content — never write it directly.
    await db
      .update(schema.chatMessages)
      .set({ content: text, toolCalls: meta })
      .where(eq(schema.chatMessages.id, revising.id));
  } else {
    await db.insert(schema.chatMessages).values({
      threadId: thread.id,
      role: "assistant",
      content: text,
      toolCalls: meta,
    });
  }
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
  const latest = await latestNonDebriefMessage(thread.id);
  if (!latest || localYmd(latest.createdAt) !== localYmd(now)) return null;
  const meta = (latest.toolCalls ?? {}) as { warning?: string | null };
  return {
    text: latest.content,
    warning: meta.warning ?? null,
    threadId: thread.id,
    createdAt: latest.createdAt,
  };
}

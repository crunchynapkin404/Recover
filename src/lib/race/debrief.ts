// src/lib/race/debrief.ts — post-race debrief: link the result, close the
// race, and post one honest coach-thread comparison of plan vs execution.
// Strava firewall: a Strava result is LINKED (bookkeeping) but its stats
// never enter the narrative (Nov 2024 API agreement).
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
} from "drizzle-orm";
import { generateText } from "ai";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveProvider } from "@/lib/llm-provider";
import { recordLlmUsage } from "@/lib/llm-usage";
import { buildSystemPrompt } from "@/lib/coach-persona";
import { fetchAthleteContext } from "@/lib/coach-context";
import { inferSports } from "@/lib/training-plan";
import { findOrCreateMorningThread } from "@/lib/morning-insight";
import { describeActivityOnStravaForUser } from "@/lib/strava-describer";

export const DEBRIEF_NO_DATA_HOURS = 48;

/** The transaction handle `db.transaction()`'s callback receives — used so
 * the chat-message post and the races-row update it accompanies commit (or
 * fail) together. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The training plan linked to this specific race (Task 11: trainingPlans.raceId),
 * not just "whatever plan is active" — a user can have multiple plans/races in
 * flight. Returns null when the race has no linked plan (e.g. a race added
 * without going through plan generation); callers must treat that as an early
 * guard and skip taper-adherence lines rather than querying with a placeholder id.
 */
async function planIdForRace(
  userId: string,
  raceId: string
): Promise<string | null> {
  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, userId),
      eq(schema.trainingPlans.raceId, raceId)
    ),
    columns: { id: true },
  });
  return plan?.id ?? null;
}

/** Exact morning-insight LLM/template/timeout pattern: LLM-phrased when a
 * provider (or test override) is available (10s cap), deterministic template
 * otherwise. Never throws. */
async function phrase(
  userId: string,
  instruction: string,
  template: string,
  llmOverride?: (prompt: string) => Promise<string>
): Promise<string> {
  try {
    if (llmOverride) {
      const out = (await llmOverride(instruction)).trim();
      if (out) return out;
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
            todayDate: localYmd(new Date()),
            personality: resolved.personality,
          }) + `\n\n${context}`;
        const res = await generateText({
          model: resolved.provider(resolved.model),
          system,
          prompt: instruction,
          abortSignal: AbortSignal.timeout(10_000),
        });
        const out = res.text;
        await recordLlmUsage({
          userId,
          model: resolved.model,
          slot: resolved.slot,
          purpose: "race_debrief",
          inputTokens: res.totalUsage?.inputTokens ?? res.usage?.inputTokens,
          outputTokens: res.totalUsage?.outputTokens ?? res.usage?.outputTokens,
        });
        if (out.trim()) return out.trim();
      }
    }
  } catch (err) {
    logger.warn("race debrief LLM failed — using template", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return template;
}

/**
 * Insert one assistant message into the athlete's morning thread. Takes the
 * transaction handle from the caller's `db.transaction(...)` block so the
 * post commits atomically with the races-row update that marks the race
 * debriefed — otherwise a crash between the two would leave the message
 * posted but `debriefedAt` null, and the next tick would post it again.
 */
async function postDebrief(
  userId: string,
  text: string,
  raceId: string | null,
  now: Date,
  tx: Tx
): Promise<void> {
  const thread = await findOrCreateMorningThread(userId);
  await tx.insert(schema.chatMessages).values({
    threadId: thread.id,
    role: "assistant",
    content: text,
    toolCalls: { generated: "race_debrief", kind: "race_debrief", raceId },
  });
  await tx
    .update(schema.chatThreads)
    .set({ updatedAt: now })
    .where(eq(schema.chatThreads.id, thread.id));
}

export async function runRaceDebriefs(
  userId: string,
  opts?: { now?: Date; llm?: (prompt: string) => Promise<string> }
): Promise<"posted" | "skipped"> {
  const now = opts?.now ?? new Date();
  const today = localYmd(now);

  const due = await db.query.races.findMany({
    where: and(
      eq(schema.races.userId, userId),
      eq(schema.races.status, "upcoming"),
      isNull(schema.races.debriefedAt),
      lt(schema.races.date, today)
    ),
    orderBy: asc(schema.races.date),
  });
  if (due.length === 0) return "skipped";

  // An activity must never debrief two races: exclude anything already
  // linked as another race's result (checked/updated as we go, so two due
  // races in the same tick can't both claim the same activity).
  const claimedRows = await db.query.races.findMany({
    where: and(
      eq(schema.races.userId, userId),
      isNotNull(schema.races.resultActivityId)
    ),
    columns: { resultActivityId: true },
  });
  const claimedIds = new Set(
    claimedRows
      .map((r) => r.resultActivityId)
      .filter((id): id is string => !!id)
  );

  let posted = false;
  for (const race of due) {
    const sports = inferSports(race.raceType);
    const dayStart = new Date(race.date + "T00:00:00");
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const candidates = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        gte(schema.activities.startDate, dayStart),
        lt(schema.activities.startDate, dayEnd)
      ),
      orderBy: desc(schema.activities.startDate),
    });
    const match =
      candidates.find(
        (a) => sports.includes(a.sport) && !claimedIds.has(a.id)
      ) ?? null;

    if (!match) {
      const deadline = new Date(
        dayStart.getTime() + DEBRIEF_NO_DATA_HOURS * 3_600_000
      );
      if (now < deadline) continue; // still waiting for a sync

      await db.transaction(async (tx) => {
        await postDebrief(
          userId,
          `No activity landed for ${race.name} (${race.date}) after ${DEBRIEF_NO_DATA_HOURS}h. ` +
            `If you raced, the data never arrived — mark the race completed (or skipped) yourself on the Plan page.`,
          race.id,
          now,
          tx
        );
        await tx
          .update(schema.races)
          .set({ debriefedAt: now, updatedAt: now })
          .where(eq(schema.races.id, race.id));
      });
      posted = true;
      continue;
    }

    // --- deterministic data assembly ---
    const metric = await db.query.dailyMetrics.findFirst({
      where: and(
        eq(schema.dailyMetrics.userId, userId),
        eq(schema.dailyMetrics.date, race.date)
      ),
    });
    const isStrava = match.provider === "strava";
    const statLines: string[] = [];
    if (metric?.readiness != null)
      statLines.push(
        `Race-morning readiness ${Math.round(metric.readiness)} (${metric.band}), TSB ${metric.tsb ?? "n/a"}.`
      );
    if (!isStrava) {
      if (match.durationS != null)
        statLines.push(
          `Race duration ${Math.round(match.durationS / 60)}min` +
            (match.load != null ? `, load ${match.load}` : "") +
            `.`
        );
    } else {
      statLines.push(
        `The result is a Strava activity — its numbers are excluded from AI analysis (provider agreement), so this debrief has no race stats.`
      );
    }

    // Taper adherence: last two closed blocks of the plan actually linked to
    // this race (Task 11 raceId FK) — planned vs actual load. No plan linked
    // (or none closed yet) → skip these lines rather than guess.
    const planId = await planIdForRace(userId, race.id);
    if (planId) {
      const blocks = await db.query.trainingBlocks.findMany({
        where: eq(schema.trainingBlocks.planId, planId),
      });
      const closed = blocks
        .filter((b) => b.actualLoad != null && b.targetLoadTotal != null)
        .sort((a, b) => b.weekNumber - a.weekNumber)
        .slice(0, 2);
      if (closed.length > 0) {
        // "Planned" must be the week's persisted effective target (post-
        // taper, post-hours-budget), not the block's un-tapered skeleton
        // value — otherwise a perfectly-executed taper reports as if the
        // athlete fell far short. Rows written before the column existed
        // fall back to the block's skeleton target.
        const weekRows = await db.query.weekPlans.findMany({
          where: and(
            eq(schema.weekPlans.planId, planId),
            eq(schema.weekPlans.status, "closed"),
            inArray(
              schema.weekPlans.skeletonWeek,
              closed.map((b) => b.weekNumber)
            )
          ),
          orderBy: asc(schema.weekPlans.weekStart),
        });
        // Later weekStart wins per skeleton week — the plan-regeneration
        // edge case can leave more than one closed row per skeleton week.
        const effectiveByWeek = new Map(
          weekRows.map((w) => [w.skeletonWeek, w.effectiveTarget])
        );
        const planned = closed.reduce(
          (s, b) =>
            s + (effectiveByWeek.get(b.weekNumber) ?? b.targetLoadTotal ?? 0),
          0
        );
        const actual = closed.reduce((s, b) => s + (b.actualLoad ?? 0), 0);
        statLines.push(
          `Taper execution: planned ${Math.round(planned)} load over the final ${closed.length} week(s), actual ${Math.round(actual)}.`
        );
      }
    }

    const template =
      statLines.length > 0
        ? `${race.name} debrief: ${statLines.join(" ")}`
        : `${race.name} is done — no data to compare.`;
    const instruction =
      `Write a post-race debrief for ${race.name} (${race.priority} race, ${race.date}). ` +
      `Data: ${statLines.join(" ")} ` +
      (race.goalNote ? `The stated goal was: ${race.goalNote}. ` : "") +
      `Compare plan against execution honestly, celebrate what the data supports, flag what it doesn't, ` +
      `and close with one recovery instruction. Max 150 words. Never invent numbers not given here.`;

    const text = await phrase(userId, instruction, template, opts?.llm);
    await db.transaction(async (tx) => {
      await postDebrief(userId, text, race.id, now, tx);
      await tx
        .update(schema.races)
        .set({
          status: "completed",
          resultActivityId: match.id,
          debriefedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.races.id, race.id));
      // v0.15: a race-result activity gets only the race debrief, never
      // both — claim it for the review system so runDebriefLifecycle's
      // retry step (and generateRideReview) treat it as already reviewed,
      // even if it was promoted to `pending` before this claim landed.
      await tx
        .update(schema.activities)
        .set({ reviewedAt: now })
        .where(eq(schema.activities.id, match.id));
    });
    // Claiming the activity above resolves strava-describer's
    // awaiting_review gate (no ride review will ever follow for a race
    // result) — describe now instead of waiting for the next daily sweep.
    try {
      await describeActivityOnStravaForUser(userId, match.id);
    } catch (err) {
      logger.warn("post-race-debrief strava describe failed", {
        activityId: match.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    claimedIds.add(match.id);
    posted = true;
  }
  return posted ? "posted" : "skipped";
}

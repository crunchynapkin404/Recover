/**
 * v0.15 ride review — the coach's answer to a completed debrief. Combines the
 * activity's data with the athlete's own words (quoted, never paraphrased
 * into findings); a skipped/expired debrief produces a review that SAYS the
 * athlete gave no feedback — never "felt fine".
 *
 * Post-and-mark is one transaction (the v0.14 race-debrief lesson): message
 * insert + activities.reviewedAt commit together or not at all. Memory
 * filing (remember_fact during generation) happens outside the transaction —
 * a duplicate memory on retry is acceptable; a duplicate review is not.
 */
import { and, eq } from "drizzle-orm";
import { generateText, stepCountIs } from "ai";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { resolveProvider } from "@/lib/llm-provider";
import { buildSystemPrompt } from "@/lib/coach-persona";
import { fetchAthleteContext } from "@/lib/coach-context";
import { buildAiSdkTools } from "@/lib/tools/registry";
import { recordLlmUsage } from "@/lib/llm-usage";
import { inferSports } from "@/lib/training-plan";

export const REVIEW_MAX_ATTEMPTS = 3;

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type ActivityRow = typeof schema.activities.$inferSelect;

function statLines(a: ActivityRow, readiness: string | null): string[] {
  const lines: string[] = [];
  if (a.durationS != null)
    lines.push(
      `Duration ${Math.round(a.durationS / 60)}min` +
        (a.distanceM != null ? `, ${(a.distanceM / 1000).toFixed(1)}km` : "") +
        (a.load != null ? `, load ${Math.round(a.load)}` : "") +
        `.`
    );
  if (a.avgHr != null || a.avgPower != null)
    lines.push(
      [
        a.avgHr != null ? `avg HR ${Math.round(a.avgHr)}` : null,
        a.avgPower != null ? `avg power ${Math.round(a.avgPower)}W` : null,
      ]
        .filter(Boolean)
        .join(", ") + "."
    );
  if (readiness) lines.push(readiness);
  return lines;
}

function subjectiveLines(a: ActivityRow): string[] {
  if (a.debriefState !== "answered") {
    return ["The athlete gave no feedback on this ride."];
  }
  const lines: string[] = [];
  if (a.perceivedExertion != null)
    lines.push(`Athlete RPE: ${a.perceivedExertion}/10.`);
  if (a.feel != null) lines.push(`Felt: ${a.feel}.`);
  if (a.debriefNotes) lines.push(`Athlete notes: "${a.debriefNotes}"`);
  if (lines.length === 0)
    lines.push("The athlete answered the debrief but left every field blank.");
  return lines;
}

async function findOrCreateDebriefThread(a: ActivityRow) {
  if (a.debriefThreadId) {
    const existing = await db.query.chatThreads.findFirst({
      where: eq(schema.chatThreads.id, a.debriefThreadId),
    });
    if (existing) return existing;
  }
  const ymd = localYmd(a.startDate);
  const [created] = await db
    .insert(schema.chatThreads)
    .values({
      userId: a.userId,
      title: `Ride debrief — ${a.name ?? a.sport} ${ymd}`,
      kind: "debrief",
    })
    .returning();
  return created;
}

export async function generateRideReview(
  activityId: string,
  opts?: { now?: Date; llm?: (prompt: string) => Promise<string> }
): Promise<"posted" | "skipped" | "failed"> {
  const now = opts?.now ?? new Date();
  const a = await db.query.activities.findFirst({
    where: eq(schema.activities.id, activityId),
  });
  if (!a) return "skipped";
  if (a.reviewedAt) return "skipped";
  if (a.provider === "strava") return "skipped"; // AI firewall
  if (
    a.debriefState !== "answered" &&
    a.debriefState !== "skipped" &&
    a.debriefState !== "expired"
  )
    return "skipped";

  // v0.15 fix: a race-result activity gets only the race debrief, never a
  // separate ride review — defer to runRaceDebriefs (src/lib/race/debrief.ts),
  // which claims the activity (sets reviewedAt) the day after the race. If
  // this activity lands on the same calendar day as an upcoming race whose
  // inferred sports include this activity's sport, skip here; the retry step
  // in runDebriefLifecycle will re-call this once the race is no longer
  // "upcoming" (claimed, or manually completed/skipped by the athlete).
  const activityYmd = localYmd(a.startDate);
  const raceMatch = await db.query.races.findFirst({
    where: and(
      eq(schema.races.userId, a.userId),
      eq(schema.races.status, "upcoming"),
      eq(schema.races.date, activityYmd)
    ),
  });
  if (raceMatch && inferSports(raceMatch.raceType).includes(a.sport))
    return "skipped";

  const thread = await findOrCreateDebriefThread(a);

  // Attempts cap: honest failure note instead of silence.
  if (a.reviewAttempts >= REVIEW_MAX_ATTEMPTS) {
    await db.transaction(async (tx) => {
      await tx.insert(schema.chatMessages).values({
        threadId: thread.id,
        role: "assistant",
        content:
          "This ride's review couldn't be generated (the coach model kept failing). Your RPE and notes are saved — ask the coach about the ride any time.",
        toolCalls: { generated: "ride_review", outcome: "failed" },
      });
      await tx
        .update(schema.activities)
        .set({ reviewedAt: now, debriefThreadId: thread.id })
        .where(eq(schema.activities.id, a.id));
      await tx
        .update(schema.chatThreads)
        .set({ updatedAt: now })
        .where(eq(schema.chatThreads.id, thread.id));
    });
    return "posted";
  }

  const metric = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, a.userId),
    orderBy: (t, { desc }) => [desc(t.date)],
  });
  const readinessLine =
    metric && metric.date === localYmd(a.startDate) && metric.readiness != null
      ? `Readiness that morning: ${Math.round(metric.readiness)} (${metric.band}).`
      : null;

  const stats = statLines(a, readinessLine);
  const subj = subjectiveLines(a);
  const ymd = localYmd(a.startDate);
  const template = [
    `Ride review — ${a.name ?? a.sport} (${ymd}):`,
    ...stats,
    ...subj,
  ].join(" ");

  const instruction =
    `Write a short ride review for ${a.name ?? a.sport} on ${ymd}.\n` +
    `Data: ${stats.join(" ")}\n` +
    `Athlete input: ${subj.join(" ")}\n\n` +
    `Instructions:\n` +
    `- Reconcile the numbers with how it felt: a high RPE on an easy ride is worth flagging, a low RPE on a hard day is a good sign.\n` +
    `- Quote the athlete's words when you reference them — never paraphrase them into findings.\n` +
    `- If the athlete gave no feedback, open by saying so.\n` +
    `- If the notes mention pain or injury, file it with remember_fact.\n` +
    `- 3-5 sentences, plain text. Never invent numbers not given here.`;

  let text = template;
  try {
    if (opts?.llm) {
      const out = (await opts.llm(instruction)).trim();
      if (out) text = out;
    } else {
      const resolved = await resolveProvider(a.userId, "quick");
      if (resolved) {
        const [user, context] = await Promise.all([
          db.query.users.findFirst({ where: eq(schema.users.id, a.userId) }),
          fetchAthleteContext(a.userId, db),
        ]);
        const system =
          buildSystemPrompt({
            userName: user?.name ?? "the athlete",
            todayDate: localYmd(now),
            personality: resolved.personality,
          }) + `\n\n${context}`;
        // Memory tools only: the review may file pain/injury mentions, but
        // must not wander into the full registry.
        const memoryTools = Object.fromEntries(
          Object.entries(buildAiSdkTools({ userId: a.userId, db })).filter(
            ([name]) => name === "remember_fact"
          )
        );
        const res = await generateText({
          model: resolved.provider(resolved.model),
          system,
          prompt: instruction,
          tools: memoryTools,
          stopWhen: stepCountIs(3),
          abortSignal: AbortSignal.timeout(15_000),
        });
        await recordLlmUsage({
          userId: a.userId,
          model: resolved.model,
          slot: resolved.slot,
          purpose: "ride_review",
          inputTokens: res.totalUsage?.inputTokens ?? res.usage?.inputTokens,
          outputTokens: res.totalUsage?.outputTokens ?? res.usage?.outputTokens,
        });
        if (res.text.trim()) text = res.text.trim();
      }
    }
  } catch (err) {
    logger.warn("ride review LLM failed", {
      activityId: a.id,
      message: err instanceof Error ? err.message : String(err),
    });
    await db
      .update(schema.activities)
      .set({ reviewAttempts: a.reviewAttempts + 1, debriefThreadId: thread.id })
      .where(eq(schema.activities.id, a.id));
    return "failed";
  }

  await db.transaction(async (tx) => {
    await tx.insert(schema.chatMessages).values({
      threadId: thread.id,
      role: "assistant",
      content: text,
      toolCalls: { generated: "ride_review", activityId: a.id },
    });
    await tx
      .update(schema.activities)
      .set({ reviewedAt: now, debriefThreadId: thread.id })
      .where(eq(schema.activities.id, a.id));
    await tx
      .update(schema.chatThreads)
      .set({ updatedAt: now })
      .where(eq(schema.chatThreads.id, thread.id));
  });
  return "posted";
}

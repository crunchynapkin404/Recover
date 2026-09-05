/**
 * v0.15 debrief lifecycle — one pass per user: expire yesterday's untouched
 * card (data-only review; never a fabricated "felt fine"), retry unreviewed
 * resolved debriefs (generateRideReview caps attempts), then promote the
 * oldest eligible activity to pending (at most ONE pending per user) and
 * send the opt-in push.
 *
 * Called after each activity poll, after each daily sync (post-sync chain),
 * and after a manual activity log. Never throws to callers.
 */
import { and, asc, eq, gte, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateRideReview } from "@/lib/debrief/ride-review";

/**
 * Minimum activity duration to become debrief-eligible — shorter sessions
 * never reach `debriefState = 'pending'`. Source:
 * `docs/specs/2026-07-19-v0.15-coach-remembers-design.md` ("duration ≥ 15
 * min becomes pending"). Confidence: Low.
 */
export const DEBRIEF_MIN_DURATION_S = 15 * 60;
/**
 * Activities older than this get no debrief prompt — historical imports
 * are excluded, not just late ones. Source: same v0.15 design doc
 * ("started within the last 24 h — no debrief prompts for historical
 * imports"). Confidence: Low.
 */
export const DEBRIEF_FRESH_HOURS = 24;
/**
 * How far back the promotion query looks for a ride still waiting its turn.
 * One debrief is pending per user at a time and a card holds the slot for a
 * day, so a heavy day can queue several rides across several days — but a
 * prompt about a ride from a fortnight ago is noise, and an unbounded query
 * would scan an athlete's whole history. Rides that fall off the end keep
 * `debriefState = null`, exactly as they do today.
 */
export const DEBRIEF_QUEUE_MAX_DAYS = 14;

export function debriefEligible(
  a: {
    provider: string;
    durationS: number | null;
    startDate: Date;
    debriefState: string | null;
    createdAt?: Date | null;
    raw?: unknown;
  },
  now: Date
): boolean {
  if (a.provider === "strava") return false; // AI firewall — no review possible
  if (a.debriefState !== null) return false; // already in the loop (or resolved)
  if (a.durationS == null) {
    // intervals.icu withholds duration/load for activities it sourced from
    // Strava (its own API response carries "STRAVA activities are not
    // available via the API") — a real create event already proves this is
    // a genuine ride, so an unknowable duration shouldn't block it forever.
    // Any other null-duration case (not yet populated) still waits its turn.
    const stravaSourced =
      (a.raw as { source?: unknown } | null | undefined)?.source === "STRAVA";
    if (!stravaSourced) return false;
  } else if (a.durationS < DEBRIEF_MIN_DURATION_S) {
    return false;
  }
  // FRESH WHEN INGESTED, not fresh right now. The 24 h rule exists to keep
  // historical imports from raising a pile of retroactive prompts — it is
  // about how old the ride was when the app first saw it. Measuring it
  // against `now` instead made the queue leak: only one debrief is pending
  // per user at a time, so a second ride of the same day waits its turn, and
  // by the time the slot freed the next morning the ride had aged past 24 h
  // and was never promoted, never expired and never reviewed. Rides 2..n of
  // a day simply disappeared. `createdAt` is when the row landed, so a
  // backfilled 2019 ride is still excluded — it was old on arrival — while
  // yesterday's ride keeps its place in the queue.
  const ingested = a.createdAt ?? now;
  const age = ingested.getTime() - a.startDate.getTime();
  if (age < 0 || age > DEBRIEF_FRESH_HOURS * 3_600_000) return false;
  // A ride that has not happened yet gets no debrief, whatever its row says
  // about when it was written. `age < 0` above catches the same thing for
  // ingestion; this is the check against the clock, which the old
  // `now - startDate` form gave for free.
  if (a.startDate.getTime() > now.getTime()) return false;
  return true;
}

/** "1:15 · 78 load · 32km · 142bpm" — only the metrics that exist; shared by
 *  the URL-driven sheet and the activity page's own popup mount. */
export function formatActivityMetrics(a: {
  durationS: number | null;
  load: number | null;
  distanceM: number | null;
  avgHr: number | null;
}): string {
  const clock = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.round((secs % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}`;
  };
  return [
    a.durationS != null ? clock(a.durationS) : null,
    a.load != null ? `${Math.round(a.load)} load` : null,
    a.distanceM != null
      ? `${(a.distanceM / 1000).toFixed(a.distanceM < 10_000 ? 1 : 0)}km`
      : null,
    a.avgHr != null ? `${Math.round(a.avgHr)}bpm` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** intervals.icu `feel` is 1–5 with 1 = strongest. */
export function feelFromIcu(
  feel: unknown
): "strong" | "normal" | "weak" | null {
  if (typeof feel !== "number" || !Number.isFinite(feel)) return null;
  if (feel <= 2) return "strong";
  if (feel === 3) return "normal";
  return "weak";
}

export function rpeFromRaw(raw: unknown): number | null {
  const rpe = (raw as { icu_rpe?: unknown } | null)?.icu_rpe;
  return typeof rpe === "number" && rpe >= 1 && rpe <= 10 ? rpe : null;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Claim an activity as the user's pending debrief. Returns false when someone
 * else got there first.
 *
 * A ride sets several lifecycle passes running within minutes of each other —
 * Strava fires `create` AND `update` webhooks and each schedules its own
 * intervals catch-up sync, the 15-minute activity poll sweeps independently,
 * both provider sync jobs run the post-sync chain, and `/api/sync/now` runs a
 * whole tick on pull-to-refresh. Two of those overlapping would each read
 * "nothing pending" and each promote the same ride, and the push fires on
 * promotion — so the athlete gets the same notification twice. The state
 * transition, not the earlier read, is what decides.
 */
export async function claimPendingDebrief(
  activityId: string,
  now: Date = new Date()
): Promise<boolean> {
  const claimed = await db
    .update(schema.activities)
    // `debriefPendingAt` is written by the same statement that wins the
    // claim, so the card's own day is recorded exactly once — see the
    // column's note in schema.ts and the expiry rule below.
    .set({ debriefState: "pending", debriefPendingAt: now })
    .where(
      and(
        eq(schema.activities.id, activityId),
        isNull(schema.activities.debriefState)
      )
    )
    .returning();
  return claimed.length > 0;
}

export async function runDebriefLifecycle(
  userId: string,
  opts?: { now?: Date; llm?: (prompt: string) => Promise<string> }
): Promise<void> {
  const now = opts?.now ?? new Date();
  const today = localYmd(now);

  try {
    // Kill switch — checked once, up front, before any lifecycle step runs.
    // No row = default enabled (matches the schema's notNull().default(true)
    // and the "no row = default" convention used elsewhere in this file).
    const prefs = await db.query.notificationPrefs.findFirst({
      where: eq(schema.notificationPrefs.userId, userId),
    });
    if (prefs?.rideDebriefsEnabled === false) return;

    // 1) Expire pending cards from a previous day → data-only review.
    const pendingRows = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        eq(schema.activities.debriefState, "pending")
      ),
    });
    for (const a of pendingRows) {
      // The card's own day, not the ride's. A ride from Saturday is promoted
      // on Sunday morning when the slot frees, and the athlete gets Sunday to
      // answer it; reading the RIDE's date here expired that card at the very
      // next 15-minute tick, after its push had already gone out — so every
      // ride after the first of a day was unanswerable by construction.
      // `debriefPendingAt` is null on cards promoted before v0.139.0, which
      // fall back to the old rule so they still expire rather than sticking.
      const shownOn = localYmd(
        a.debriefPendingAt ?? a.startDateLocal ?? a.startDate
      );
      if (shownOn < today) {
        await db
          .update(schema.activities)
          .set({ debriefState: "expired" })
          .where(
            and(
              eq(schema.activities.id, a.id),
              eq(schema.activities.debriefState, "pending")
            )
          );
        await generateRideReview(a.id, opts);
      }
    }

    // 2) Retry resolved-but-unreviewed debriefs (attempt cap lives in the
    //    generator; it posts an honest failure note at the cap).
    const unreviewed = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        isNull(schema.activities.reviewedAt),
        ne(schema.activities.provider, "strava")
      ),
    });
    for (const a of unreviewed) {
      if (
        a.debriefState === "answered" ||
        a.debriefState === "skipped" ||
        a.debriefState === "expired"
      ) {
        await generateRideReview(a.id, opts);
      }
    }

    // 3) Promote the oldest eligible activity — only if nothing is pending.
    const stillPending = await db.query.activities.findFirst({
      where: and(
        eq(schema.activities.userId, userId),
        eq(schema.activities.debriefState, "pending")
      ),
    });
    if (stillPending) return;

    // Bounded by INGESTION, matching debriefEligible: a ride queued behind
    // another keeps its place however long the queue takes, and a backfill of
    // old rides is still excluded because it was old when it arrived. The
    // window is generous here and exact in debriefEligible — this clause only
    // has to keep the query from scanning an athlete's whole history.
    const queueCutoff = new Date(
      now.getTime() - DEBRIEF_QUEUE_MAX_DAYS * 86_400_000
    );
    const candidates = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        isNull(schema.activities.debriefState),
        ne(schema.activities.provider, "strava"),
        gte(schema.activities.createdAt, queueCutoff)
      ),
      orderBy: [asc(schema.activities.startDate)],
    });
    const next = candidates.find((a) => debriefEligible(a, now));
    if (!next) return;

    // Only the pass that actually flips the row may notify.
    if (!(await claimPendingDebrief(next.id, now))) return;

    if (prefs?.debriefPushEnabled) {
      try {
        const { sendToUser, buildDebriefPayload } = await import("@/lib/push");
        await sendToUser(
          userId,
          buildDebriefPayload({
            activityId: next.id,
            activityName: next.name ?? next.sport,
            durationS: next.durationS,
            load: next.load,
          }),
          { activityId: next.id }
        );
      } catch (err) {
        logger.warn("debrief push failed", {
          userId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error("debrief lifecycle failed", {
      userId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

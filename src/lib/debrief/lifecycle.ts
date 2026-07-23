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

export const DEBRIEF_MIN_DURATION_S = 15 * 60;
export const DEBRIEF_FRESH_HOURS = 24;

export function debriefEligible(
  a: {
    provider: string;
    durationS: number | null;
    startDate: Date;
    debriefState: string | null;
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
      (a.raw as { source?: unknown } | null | undefined)?.source ===
      "STRAVA";
    if (!stravaSourced) return false;
  } else if (a.durationS < DEBRIEF_MIN_DURATION_S) {
    return false;
  }
  const age = now.getTime() - a.startDate.getTime();
  if (age < 0 || age > DEBRIEF_FRESH_HOURS * 3_600_000) return false;
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
      if (localYmd(a.startDate) < today) {
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

    const freshCutoff = new Date(
      now.getTime() - DEBRIEF_FRESH_HOURS * 3_600_000
    );
    const candidates = await db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        isNull(schema.activities.debriefState),
        ne(schema.activities.provider, "strava"),
        gte(schema.activities.startDate, freshCutoff)
      ),
      orderBy: [asc(schema.activities.startDate)],
    });
    const next = candidates.find((a) => debriefEligible(a, now));
    if (!next) return;

    await db
      .update(schema.activities)
      .set({ debriefState: "pending" })
      .where(eq(schema.activities.id, next.id));

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
          })
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

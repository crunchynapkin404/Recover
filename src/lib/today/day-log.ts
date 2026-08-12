import { localYmd } from "@/lib/charts";

/**
 * The fields `debriefLineFor` actually reads off an activity row. Named
 * separately from the Drizzle-inferred activity type so this module has no
 * dependency on the schema — it only needs to agree on shape.
 */
export interface DebriefCandidate {
  debriefState: "pending" | "answered" | "skipped" | "expired" | null;
  name: string | null;
  sport: string;
  perceivedExertion: number | null;
  feel: "strong" | "normal" | "weak" | null;
  startDate: Date;
  startDateLocal: Date | null;
}

/**
 * "Today's log"'s debrief line — the day's OWN debrief, or null.
 *
 * NOT the same check as "is this the most recent activity". The candidate
 * this is called with (page.tsx's `recentActivity`) is windowed by
 * `resolveTodayState`'s post-session logic, which deliberately spans
 * midnight — a ride ending at 23:30 must still lead "post-session" at
 * 00:15, so that window cannot also be trusted to mean "today" (C4,
 * whole-branch review 2026-08-12). Without this same-day check, an athlete
 * who rode and debriefed yesterday evening opened Today the next morning
 * and read "Today's log — Endurance Spin — RPE 6 · felt normal" describing
 * a ride from up to 47 hours ago.
 *
 * `todayYmd` is the caller's own local calendar day (the container's TZ),
 * computed once and threaded through rather than re-derived here, so the
 * whole page agrees on what day it is.
 */
export function debriefLineFor(
  activity: DebriefCandidate | null | undefined,
  todayYmd: string
): string | null {
  if (!activity || activity.debriefState !== "answered") return null;
  if (localYmd(activity.startDateLocal ?? activity.startDate) !== todayYmd)
    return null;

  return [
    activity.name ?? activity.sport,
    [
      activity.perceivedExertion != null
        ? `RPE ${Math.round(activity.perceivedExertion)}`
        : null,
      activity.feel != null ? `felt ${activity.feel}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  ]
    .filter((p) => p !== "")
    .join(" — ");
}

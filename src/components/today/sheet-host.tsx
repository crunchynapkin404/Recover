import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  feelFromIcu,
  formatActivityMetrics,
  rpeFromRaw,
} from "@/lib/debrief/lifecycle";
import { CheckinSheet } from "@/components/today/checkin-sheet";
import { DebriefSheet } from "@/components/debrief/debrief-sheet";

/**
 * The id arrives from the URL (and from a push payload), so it is checked
 * before it reaches Postgres — an unparseable uuid raised a query error and
 * took the whole page down with a 500 rather than simply not opening a
 * sheet.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "1:15" — the compact clock the sheets and history rows share. */
function clock(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Server side of the URL-driven sheets: `?sheet=checkin` and
 * `?sheet=debrief&activity=…`. Everything a sheet shows is fetched here, so
 * a push notification can deep-link straight into an open sheet with real
 * numbers already in it — the client components hold no data of their own.
 *
 * An unknown sheet name, or a debrief for an activity that isn't the
 * athlete's, renders nothing rather than an empty dialog.
 */
export async function SheetHost({
  userId,
  sheet,
  activityId,
  closeHref,
  todayYmd,
}: {
  userId: string;
  sheet: string | undefined;
  activityId: string | undefined;
  closeHref: string;
  todayYmd: string;
}) {
  if (sheet === "checkin") {
    // Today's row if the overnight sync has landed; otherwise the most
    // recent one that carries vitals, labelled with its own date. Showing
    // yesterday's HRV under a bare "Synced" would misdate it.
    const recent = await db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        gte(schema.wellnessDaily.date, addDays(todayYmd, -7))
      ),
      orderBy: schema.wellnessDaily.date,
    });
    const latest = [...recent]
      .reverse()
      .find(
        (w) => w.hrvMs != null || w.restingHr != null || w.sleepSecs != null
      );
    const prefs = await db.query.journalPrefs.findFirst({
      where: eq(schema.journalPrefs.userId, userId),
      columns: { usualBehaviorTags: true },
    });
    return (
      <CheckinSheet
        date={todayYmd}
        dateLabel={new Date(todayYmd + "T00:00:00").toLocaleDateString(
          "en-US",
          {
            weekday: "short",
            month: "short",
            day: "numeric",
          }
        )}
        synced={{
          hrv: latest?.hrvMs ?? null,
          rhr: latest?.restingHr ?? null,
          sleepClock:
            latest?.sleepSecs != null ? clock(latest.sleepSecs) : null,
          from: latest == null || latest.date === todayYmd ? null : latest.date,
        }}
        usualTags={prefs?.usualBehaviorTags ?? []}
        closeHref={closeHref}
      />
    );
  }

  if (sheet === "debrief") {
    // Scoped by userId: an activity id from another account finds nothing.
    const activity =
      activityId && UUID.test(activityId)
        ? await db.query.activities.findFirst({
            where: and(
              eq(schema.activities.id, activityId),
              eq(schema.activities.userId, userId)
            ),
          })
        : activityId
          ? null
          : await db.query.activities.findFirst({
              where: and(
                eq(schema.activities.userId, userId),
                eq(schema.activities.debriefState, "pending")
              ),
            });
    if (!activity) return null;

    const raw = activity.raw as Record<string, unknown> | null;
    const metrics = formatActivityMetrics(activity);

    return (
      <DebriefSheet
        activityId={activity.id}
        activityName={activity.name ?? activity.sport}
        metrics={metrics}
        prefillRpe={rpeFromRaw(raw)}
        prefillFeel={feelFromIcu(raw?.feel)}
        closeHref={closeHref}
      />
    );
  }

  return null;
}

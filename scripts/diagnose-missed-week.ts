/**
 * READ-ONLY diagnostic. Answers one question: why did a week the athlete
 * actually rode close as "fully missed"?
 *
 * Prints, for the last few weeks: the stored week_plans row, each day's
 * status and booked load, and the activities that fall inside that week.
 * A day showing a real activity but actualLoad/unplannedLoad null is a
 * booking failure; a whole week of them points at the daily adaptation
 * never having run.
 *
 * Performs SELECTs only. Never writes.
 */
import { db, schema } from "@/lib/db";
import { desc, eq, gte } from "drizzle-orm";

type Day = {
  date: string;
  status?: string;
  workouts?: { sport?: string; type?: string; durationMins?: number }[];
  actualLoad?: number | null;
  unplannedLoad?: number | null;
  activityId?: string | null;
  availableMins?: number;
};

async function main() {
  const weeks = await db.query.weekPlans.findMany({
    orderBy: desc(schema.weekPlans.weekStart),
    limit: 4,
  });

  if (weeks.length === 0) {
    console.log("no week_plans rows at all");
    return;
  }

  const oldest = weeks[weeks.length - 1].weekStart;
  const acts = await db.query.activities.findMany({
    where: gte(schema.activities.startDate, new Date(oldest + "T00:00:00")),
    orderBy: desc(schema.activities.startDate),
  });

  console.log(`\nactivities in Recover's DB since ${oldest}: ${acts.length}`);
  for (const a of acts) {
    const d = (a.startDateLocal ?? a.startDate) as Date;
    console.log(
      `  ${d.toISOString().slice(0, 10)}  ${String(a.sport).padEnd(14)} ` +
        `load=${String(a.load ?? "null").padStart(5)}  ${a.provider ?? "?"}`
    );
  }

  for (const w of weeks) {
    const days = (w.days ?? []) as Day[];
    const booked = days.reduce(
      (s, d) => s + (d.actualLoad ?? 0) + (d.unplannedLoad ?? 0),
      0
    );
    console.log(
      `\n=== week ${w.weekStart}  status=${w.status}  skeletonWeek=${w.skeletonWeek}` +
        `  effectiveTarget=${w.effectiveTarget}  bookedLoad=${booked}` +
        `  updated=${w.updatedAt?.toISOString?.().slice(0, 16) ?? "?"}`
    );
    for (const d of days) {
      const w0 = d.workouts?.[0];
      console.log(
        `  ${d.date}  ${String(d.status).padEnd(10)}` +
          `  planned=${w0 ? `${w0.sport}/${w0.type} ${w0.durationMins}m` : "-"}`.padEnd(
            34
          ) +
          `  actual=${String(d.actualLoad ?? "-").padStart(4)}` +
          `  unplanned=${String(d.unplannedLoad ?? "-").padStart(4)}` +
          `  activityId=${d.activityId ?? "-"}`
      );
    }
  }

  // createdAt is the tell: it says WHEN the daily adaptation actually ran,
  // which is the thing the day records themselves cannot show.
  for (const w of weeks) {
    const adj = await db.query.planAdjustments.findMany({
      where: eq(schema.planAdjustments.weekPlanId, w.id),
      orderBy: desc(schema.planAdjustments.createdAt),
    });
    console.log(
      `\nadjustments on week ${w.weekStart} (${w.status}) — ${adj.length} rows:`
    );
    for (const a of adj) {
      console.log(
        `  ran=${a.createdAt?.toISOString().slice(0, 16)}  for=${a.date}  ` +
          `${a.trigger}/${a.action}  ${a.reason.slice(0, 70)}`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

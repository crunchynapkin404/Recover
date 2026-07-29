/**
 * One-off repair: restores an OPEN week's intended sessions after the
 * pre-fix compounding readiness adaptation ground them down (see
 * docs/plans/2026-07-29-adaptation-idempotency-hotfix.md). The idempotency
 * fix itself stops further damage; it cannot undo a session already
 * shrunk before it shipped — a recovery to green restores a 137-minute
 * Long to whatever it was last scaled to (60min), not to 137.
 *
 * All the actual derivation lives in src/lib/week-plan/repair.ts — this is
 * a thin CLI wrapper. See that file for the full rationale, in particular
 * why days are only ever fully protected by status (completed/missed/race)
 * while actualLoad/unplannedLoad/activityId are carried over on every day
 * regardless of status.
 *
 * Dry-run by default: prints the per-day before/after table and writes
 * nothing. Pass --apply to write. The same table prints either way, so the
 * operator sees exactly what changed (or would change).
 *
 * Idempotent: a day already matching its recomputed value is left alone —
 * running this twice produces no further change the second time.
 *
 * Usage: npx tsx scripts/repair-corrupted-week.ts [--apply] [--user <id>]
 */
import { fileURLToPath } from "node:url";
// Relative imports, not "@/" — matches the other scripts: tsx run standalone
// doesn't resolve the tsconfig path alias.
import {
  applyWeekRepair,
  computeWeekRepair,
  usersWithOpenWeek,
  type DayRepair,
  type WeekRepair,
} from "../src/lib/week-plan/repair";

function fmtWorkouts(day: {
  workouts: { sport: string; type: string; durationMins: number }[];
}): string {
  if (day.workouts.length === 0) return "-";
  return day.workouts
    .map((w) => `${w.sport}/${w.type} ${w.durationMins}m`)
    .join(" + ");
}

function fmtLoad(day: {
  actualLoad?: number | null;
  unplannedLoad?: number | null;
  activityId?: string | null;
}): string {
  return (
    `actual=${String(day.actualLoad ?? "-")}` +
    `  unplanned=${String(day.unplannedLoad ?? "-")}` +
    `  activityId=${day.activityId ?? "-"}`
  );
}

function printDay(d: DayRepair): void {
  const mark = d.settled ? "settled" : d.changed ? "CHANGED" : "unchanged";
  console.log(`  ${d.date}  [${mark}]`);
  console.log(
    `      status      ${String(d.before.status).padEnd(10)} -> ${d.after.status}`
  );
  console.log(
    `      workouts    ${fmtWorkouts(d.before).padEnd(30)} -> ${fmtWorkouts(d.after)}`
  );
  console.log(`      load before ${fmtLoad(d.before)}`);
  if (d.changed) console.log(`      load after  ${fmtLoad(d.after)}`);
  if (d.before.readinessBase && !d.settled) {
    console.log(
      `      readinessBase cleared (was band=${d.before.readinessBase.band}, anchored ${d.before.readinessBase.date})`
    );
  }
}

function printWeek(repair: WeekRepair): void {
  console.log(
    `\nuser ${repair.userId}  week ${repair.weekStart}  (weekPlanId ${repair.weekPlanId})`
  );
  for (const d of repair.days) printDay(d);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const userIdx = process.argv.indexOf("--user");
  const userId = userIdx > -1 ? process.argv[userIdx + 1] : undefined;

  const userIds = userId ? [userId] : await usersWithOpenWeek();
  console.log(apply ? "APPLYING\n" : "DRY RUN — nothing will be written\n");

  let repairedCount = 0;
  let checkedCount = 0;
  for (const uid of userIds) {
    const repair = await computeWeekRepair(uid, new Date());
    if (!repair) {
      console.log(`\nuser ${uid}: no open week — skipped`);
      continue;
    }
    checkedCount++;
    printWeek(repair);
    if (!repair.changed) {
      console.log(`  -> already correct, nothing to repair`);
      continue;
    }
    repairedCount++;
    if (apply) {
      await applyWeekRepair(repair);
      console.log(`  -> written`);
    } else {
      console.log(`  -> would write (dry run)`);
    }
  }

  console.log(
    `\n${repairedCount} week(s) ${apply ? "repaired" : "would be repaired"} of ${checkedCount} open week(s) checked.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

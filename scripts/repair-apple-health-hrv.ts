/**
 * v0.97 repair: relocate the HRV values apple-health.ts wrote into the
 * rMSSD column.
 *
 * HealthKit's only HRV quantity type is SDNN, but the connector mapped it
 * to `hrvMs` until 2026-08-11 — so every Apple Health day contributed an
 * SDNN value to the rMSSD baseline it was then z-scored against. On the
 * live owner account that is four rows inside the active 60-day window.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Scope is MANDATORY: --user <id|email>. There is no --all. This walks
 * wellness_daily, and a DB-wide pass that also writes is the exact shape
 * that has previously put fabricated rows into real accounts in this repo.
 *
 * Only rows whose `field_sources.hrvMs` is 'apple_health' are touched — a
 * value intervals.icu owns is a real rMSSD reading and must not move. When
 * the row already carries an `hrv_sdnn_ms` (the Companion got there first,
 * with a better-attributed measurement), the mislabelled `hrv_ms` is
 * cleared rather than relocated: never overwrite the better source.
 *
 * field_sources is rewritten as a jsonb delta, never a whole-map overwrite
 * — two concurrent writers would otherwise each erase the other's
 * ownership records from a stale read.
 */
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export interface RepairRow {
  date: string;
  hrvMs: number;
  action: "relocate" | "clear";
}

export async function repairAppleHealthHrv(
  userId: string,
  opts: { apply: boolean }
): Promise<RepairRow[]> {
  const rows = await db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, userId),
  });

  const targets = rows
    .filter(
      (r) =>
        r.hrvMs != null &&
        (r.fieldSources as Record<string, string> | null)?.hrvMs ===
          "apple_health"
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const plan: RepairRow[] = targets.map((r) => ({
    date: r.date,
    hrvMs: r.hrvMs!,
    action: r.hrvSdnnMs == null ? "relocate" : "clear",
  }));

  if (!opts.apply) return plan;

  for (const r of targets) {
    const relocate = r.hrvSdnnMs == null;
    await db
      .update(schema.wellnessDaily)
      .set({
        hrvMs: null,
        ...(relocate ? { hrvSdnnMs: r.hrvMs } : {}),
        fieldSources: relocate
          ? sql`(coalesce(${schema.wellnessDaily.fieldSources}, '{}'::jsonb) - 'hrvMs') || '{"hrvSdnnMs":"apple_health"}'::jsonb`
          : sql`coalesce(${schema.wellnessDaily.fieldSources}, '{}'::jsonb) - 'hrvMs'`,
        updatedAt: new Date(),
      })
      .where(eq(schema.wellnessDaily.id, r.id));
  }

  return plan;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const i = process.argv.indexOf("--user");
  const userArg = i === -1 ? null : process.argv[i + 1];
  if (!userArg) {
    console.error("Refusing to run without --user <id|email>.");
    process.exit(1);
  }

  const user =
    (await db.query.users.findFirst({
      where: eq(schema.users.id, userArg),
    })) ??
    (await db.query.users.findFirst({
      where: eq(schema.users.email, userArg),
    }));
  if (!user) {
    console.error(`No user matches ${userArg}.`);
    process.exit(1);
  }

  const plan = await repairAppleHealthHrv(user.id, { apply });
  console.table(plan);
  console.log(
    apply
      ? `Applied to ${plan.length} row(s) for ${user.email}.`
      : `Dry run — ${plan.length} row(s) would change for ${user.email}. Re-run with --apply.`
  );

  if (apply && plan.length > 0) {
    const earliest = plan[0].date;
    const { computeDailyMetrics } = await import("@/lib/metrics");
    const n = await computeDailyMetrics(user.id, earliest);
    console.log(`Recomputed ${n} day(s) of metrics from ${earliest}.`);
  }
  process.exit(0);
}

if (process.argv[1]?.includes("repair-apple-health-hrv")) void main();

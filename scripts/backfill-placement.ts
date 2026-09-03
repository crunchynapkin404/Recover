/**
 * One-off backfill: rewrite every stored week so each session carries a
 * `placement` rather than a bare `blockIdx`.
 *
 * Why this exists. `week_plans.days` is jsonb with no runtime validation, and
 * every week written before the athlete-chosen-workouts release stores
 * `blockIdx: number` at the top of each session. The app reads those through
 * `normalizeDays`, so nothing is broken without this script — it exists so the
 * TRANSITIONAL DUAL WRITE in `serializeDays` (which also writes a legacy
 * top-level `blockIdx`, purely so a rollback finds the index it expects) can
 * be dropped in a later release.
 *
 * Order of operations, which matters: run this only once the release is
 * soaked and you no longer intend to roll back past it. Running it earlier is
 * harmless — the dual write means a rolled-back app still reads these rows —
 * but the point of the script is to make the dual write removable, and that
 * is a decision about the deploy, not about the data.
 *
 * Scope: every week_plans row, open and closed. Unlike backfill-day-load.ts
 * this is a pure shape migration and touches no training decision, so there is
 * no reason to limit it to recent weeks — and repair.ts leaves completed,
 * missed and race days byte-identical, which means old-shape days survive in
 * settled weeks indefinitely until something rewrites them.
 *
 * Idempotent: normalizeDays is idempotent, and a row already in the new shape
 * serialises back to itself. Safe to re-run.
 *
 * Usage: npx tsx scripts/backfill-placement.ts [--dry-run] [--user <id>]
 */
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
// Relative, not "@/" — tsx run standalone does not resolve the path alias.
import { db, schema } from "../src/lib/db";
import { normalizeDays, serializeDays } from "../src/lib/week-plan/serialize";

interface Change {
  weekPlanId: string;
  weekStart: string;
  sessions: number;
  legacySessions: number;
}

/** A session still carrying the old shape: a top-level index, no placement. */
function countLegacy(raw: unknown): { total: number; legacy: number } {
  const days = (raw ?? []) as { workouts?: Record<string, unknown>[] }[];
  let total = 0;
  let legacy = 0;
  for (const d of days) {
    for (const w of d.workouts ?? []) {
      total++;
      if (w.placement == null) legacy++;
    }
  }
  return { total, legacy };
}

async function backfill(opts: { dryRun: boolean; userId?: string }) {
  const rows = await db.query.weekPlans.findMany(
    opts.userId
      ? { where: eq(schema.weekPlans.userId, opts.userId) }
      : undefined
  );

  const changes: Change[] = [];
  for (const row of rows) {
    const { total, legacy } = countLegacy(row.days);
    if (legacy === 0) continue;

    changes.push({
      weekPlanId: row.id,
      weekStart: String(row.weekStart),
      sessions: total,
      legacySessions: legacy,
    });

    if (opts.dryRun) continue;
    await db
      .update(schema.weekPlans)
      .set({ days: serializeDays(normalizeDays(row.days)) })
      .where(eq(schema.weekPlans.id, row.id));
  }
  return { changes, scanned: rows.length };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const userIdx = process.argv.indexOf("--user");
  const userId = userIdx === -1 ? undefined : process.argv[userIdx + 1];

  const { changes, scanned } = await backfill({ dryRun, userId });

  console.log(dryRun ? "DRY RUN — nothing written\n" : "APPLIED\n");
  for (const c of changes) {
    console.log(
      `  week ${c.weekStart}  ${c.legacySessions}/${c.sessions} session(s) lifted onto placement`
    );
  }
  console.log(
    `\n${scanned} week(s) scanned, ${changes.length} ${dryRun ? "would be" : ""} rewritten.`
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

export { backfill, countLegacy };

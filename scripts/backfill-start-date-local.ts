/**
 * One-off backfill: recompute activities.startDate / startDateLocal from
 * each row's own already-stored raw JSON, using the same precedence as
 * connectors/intervals.ts, connectors/strava.ts, and
 * sync/intervals-sync.ts::upsertIntervalsActivities. No external API calls.
 * Idempotent — safe to re-run. See
 * docs/specs/2026-07-23-activity-timezone-fix-design.md.
 *
 * Usage: npx tsx scripts/backfill-start-date-local.ts [--dry-run]
 */
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
// Relative import, not "@/" — matches scripts/seed-owner.ts,
// scripts/seed-demo.ts, scripts/export-import-drill.ts: tsx run standalone
// doesn't resolve the tsconfig path alias.
import { db, schema } from "../src/lib/db";

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Parses a timezone-less wall-clock string (e.g. intervals.icu's raw
 * start_date_local, or Strava's after its misleading trailing "Z" has been
 * stripped) by treating its digits as UTC, regardless of the host process's
 * own timezone. Plain `new Date(str)` on an offset-less string parses using
 * the *executing process's* local time — which only "worked" by coincidence
 * when this script ran inside the production container (pinned to UTC).
 * Run from any other host timezone, that silently shifts the stored value
 * by the host's UTC offset — confirmed to have caused real corruption. See
 * docs/specs/2026-07-23-activity-timezone-fix-design.md.
 */
export function parseWallClockAsUtc(wallClockStr: string): Date {
  return new Date(
    wallClockStr.endsWith("Z") ? wallClockStr : wallClockStr + "Z"
  );
}

/**
 * Strava's API puts a misleading trailing "Z" on start_date_local even
 * though the digits are the athlete's local wall-clock time, not true UTC
 * (confirmed against Strava's own schema and this project's live data — see
 * connectors/strava.ts and the design doc). intervals.icu's start_date_local
 * (used both for its own rows and for Strava-stub rows it re-serves) is
 * genuinely offset-less and needs no stripping. Stripping the "Z" here (and
 * then re-anchoring via parseWallClockAsUtc below) makes both providers'
 * offset-less digits round-trip identically, independent of host timezone.
 */
function localDateStr(
  provider: string,
  raw: Record<string, unknown> | null
): string | null {
  const value = str(raw?.start_date_local);
  if (!value) return null;
  if (provider === "strava" && value.endsWith("Z")) return value.slice(0, -1);
  return value;
}

interface Delta {
  id: string;
  provider: string;
  externalId: string;
  startDateDeltaMs: number;
}

export async function backfillStartDateLocal(
  opts: { dryRun: boolean; userId?: string } = { dryRun: true }
): Promise<{ changed: number; total: number; deltas: Delta[] }> {
  // Whole-table by default (required for the real production run — see
  // Task 12). When `userId` is provided, every row this pass considers is
  // scoped to that user — used by tests to avoid ever writing to another
  // user's rows. See docs/specs/2026-07-23-activity-timezone-fix-design.md
  // and .superpowers/sdd/task-11-report.md for why this matters: a prior
  // attempt's unscoped `dryRun: false` test calls executed real writes
  // against every row in a shared/live database.
  const rows = await db.query.activities.findMany({
    where: opts.userId ? eq(schema.activities.userId, opts.userId) : undefined,
  });
  let changed = 0;
  const deltas: Delta[] = [];

  for (const row of rows) {
    const raw = row.raw as Record<string, unknown> | null;
    const localStr = localDateStr(row.provider, raw);
    const utcStr = str(raw?.start_date);

    let newStartDate = row.startDate;
    let newStartDateLocal: Date | null = row.startDateLocal;

    if (localStr) {
      const parsed = parseWallClockAsUtc(localStr);
      if (!Number.isNaN(parsed.getTime())) newStartDateLocal = parsed;
    }

    if (utcStr) {
      const parsed = new Date(utcStr);
      if (!Number.isNaN(parsed.getTime())) newStartDate = parsed;
    } else if (
      row.provider === "intervals_icu" &&
      raw?.source === "STRAVA" &&
      raw?.start_date == null
    ) {
      // Strava-sourced stub payload intervals.icu returns when it withheld
      // real data ("STRAVA activities are not available via the API") —
      // never carries a true start_date. Fall back to the sibling
      // strava-provider row's already-correct startDate, matched by
      // externalId (Strava's own connector has never had this bug). If no
      // sibling row exists (yet), leave startDate as-is — same last-resort
      // behavior the live connector falls back to, and safe here since a
      // backfill re-run after the sibling lands will pick it up then.
      const sibling = await db.query.activities.findFirst({
        where: and(
          eq(schema.activities.userId, row.userId),
          eq(schema.activities.provider, "strava"),
          eq(schema.activities.externalId, row.externalId)
        ),
        columns: { startDate: true },
      });
      if (sibling) newStartDate = sibling.startDate;
    }

    const startChanged = newStartDate.getTime() !== row.startDate.getTime();
    const localChanged =
      (newStartDateLocal?.getTime() ?? null) !==
      (row.startDateLocal?.getTime() ?? null);

    if (!startChanged && !localChanged) continue;
    changed++;
    deltas.push({
      id: row.id,
      provider: row.provider,
      externalId: row.externalId,
      startDateDeltaMs: Math.abs(
        newStartDate.getTime() - row.startDate.getTime()
      ),
    });
    if (opts.dryRun) continue;

    await db
      .update(schema.activities)
      .set({ startDate: newStartDate, startDateLocal: newStartDateLocal })
      .where(eq(schema.activities.id, row.id));
  }

  return { changed, total: rows.length, deltas };
}

// Guards the CLI entry point without `require.main` (unsafe under Vitest's
// ESM transform, which is why this file must be importable by the test
// above without side effects) — import.meta.url works in both tsx and Vitest.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes("--dry-run");
  // Optional, not required for the real production run (which is
  // deliberately whole-table) — lets an operator scope a manual invocation
  // to one user for spot-checking before/after an unscoped real run.
  const userIdFlagIndex = process.argv.indexOf("--user-id");
  const userId =
    userIdFlagIndex !== -1 ? process.argv[userIdFlagIndex + 1] : undefined;
  backfillStartDateLocal({ dryRun, userId })
    .then((result) => {
      console.log(
        `${dryRun ? "[dry run] " : ""}${result.changed} of ${result.total} activity rows ${dryRun ? "would change" : "updated"}.`
      );
      if (dryRun && result.deltas.length > 0) {
        const top = [...result.deltas]
          .sort((a, b) => b.startDateDeltaMs - a.startDateDeltaMs)
          .slice(0, 5);
        console.log("Largest startDate deltas (ms):");
        for (const d of top) {
          console.log(
            `  ${d.provider}/${d.externalId} (${d.id}): ${d.startDateDeltaMs}ms`
          );
        }
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

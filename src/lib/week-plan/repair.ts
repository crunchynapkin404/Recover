/**
 * Repairs an OPEN week corrupted by the pre-fix compounding readiness
 * adaptation (docs/plans/2026-07-29-adaptation-idempotency-hotfix.md).
 *
 * The fix itself (adapt-day.ts's `readinessBase`, service.ts's
 * activity-settled gate) only stops FURTHER damage — it cannot undo a
 * session already ground down before it shipped. This recomputes what the
 * week SHOULD hold by calling `projectWeek` (project.ts) for the open
 * week's own `weekStart` — the same derivation the next-week preview uses,
 * generalised out of this file in Task 3 of
 * docs/plans/2026-07-29-next-week-preview.md so there is exactly one copy of
 * the pipeline (`assembleVolumeInputs` -> `weeklyTargetHours` ->
 * `hoursForMaterialize` -> `periodize` -> `materializeWeek`). Because the
 * open week always has its own stored row at its own `weekStart`,
 * `projectWeek` resolves its STORED fork here: it reuses the week's own
 * already-resolved `availableBlocks` rather than re-resolving them.
 * Re-resolving availability is a replan, which the hotfix plan deliberately
 * left out of this release ("the replan 'fill' rung ... would have been
 * actively dangerous while sessions were being written off as missed") and
 * is out of scope here too.
 *
 * `periodize` (inside `projectWeek`) is a pure function of the plan's own
 * stable fields (`startingCtl`, `weeksTotal`, `daysPerWeek`, `raceType`,
 * `sports`) — none of which this repair touches — so the SAME skeleton block
 * that governed the corrupted week is reproduced exactly. That determinism
 * is what makes recovery possible at all: there is no need to
 * reverse-engineer which scaling ran when, only to recompute the answer from
 * scratch.
 *
 * A day whose status is `completed`, `missed` or `race` is historical fact
 * and is left byte-identical — every field, not just status.
 *
 * Every other day is replaced by its freshly-recomputed counterpart, WITH
 * ONE CARVE-OUT: `actualLoad`, `unplannedLoad` and `activityId` are always
 * carried over from whatever the day already held, never recomputed.
 * `projectWeek` never sets these fields (a freshly-materialized day is
 * always born without them), so carrying them forward is never in tension
 * with "restore the intended session" — it only matters because a day can
 * hold a REAL synced activity's load without being `completed`/`missed`/
 * `race`: `recordUnplannedLoad` (service.ts) books a rest-day bonus ride as
 * `unplannedLoad` while leaving `status: "rest"` untouched. Confirmed live:
 * the actual corrupted week (2026-07-27, the athlete from the hotfix
 * evidence) has a `rest`-status day carrying `unplannedLoad: 620` from a
 * real synced ride. "rest" is not a protected status — without this
 * carve-out, a field-for-field overwrite would have silently deleted it.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { projectWeek } from "./project";
import { getOpenWeekPlan } from "./service";
import type { DaySlot } from "./types";

/** Historical fact: never recomputed, never overwritten. */
const SETTLED_STATUSES = new Set<DaySlot["status"]>([
  "completed",
  "missed",
  "race",
]);

/**
 * Key-order-independent structural stringify. A day read back from Postgres
 * jsonb and a day freshly built in JS can hold identical data with
 * different key insertion order — plain `JSON.stringify` would then call
 * them "changed" when nothing actually differs, corrupting both the diff
 * table and idempotency (a second run would keep "changing" a day back and
 * forth between two orderings of the same content). Sorting keys at every
 * level, and dropping `undefined` exactly as `JSON.stringify` already does,
 * makes the comparison depend only on the data.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface DayRepair {
  date: string;
  /** true when this day's status is completed/missed/race — left untouched. */
  settled: boolean;
  before: DaySlot;
  /** The value that will be (or already was) written. Equals `before` when
   *  settled or when the recompute produced no difference. */
  after: DaySlot;
  changed: boolean;
}

export interface WeekRepair {
  userId: string;
  weekPlanId: string;
  weekStart: string;
  days: DayRepair[];
  changed: boolean;
}

/**
 * Recomputes one user's open week and returns the per-day before/after.
 * Never writes — call `applyWeekRepair` to persist. Returns `null` when the
 * user has no open week.
 */
export async function computeWeekRepair(
  userId: string,
  now: Date
): Promise<WeekRepair | null> {
  const week = await getOpenWeekPlan(userId);
  if (!week) return null;

  // The open week always has its own stored row at its own weekStart, so
  // this exercises projectWeek's STORED fork: the week's own
  // already-resolved availableBlocks, never re-resolved.
  const projected = await projectWeek(userId, week.weekStart, now);
  if (!projected) {
    // Unreachable in practice — the row read above by getOpenWeekPlan is
    // the exact row projectWeek's own lookup (same userId + weekStart) would
    // find. Guarded rather than asserted with `!` so a genuine race (the
    // week closing between these two reads) fails loudly instead of
    // silently dereferencing null.
    throw new Error(
      `projectWeek returned no projection for user ${userId}'s own open week ${week.weekStart}`
    );
  }

  const days: DayRepair[] = week.days.map((existing, i) => {
    const settled = SETTLED_STATUSES.has(existing.status);
    if (settled) {
      return {
        date: existing.date,
        settled,
        before: existing,
        after: existing,
        changed: false,
      };
    }

    const recomputed = projected.days[i];
    // Carry over real synced-activity fields unconditionally — see the
    // module docstring's carve-out. projectWeek never sets these, so this
    // only ever restores what the day already had.
    const after: DaySlot = {
      ...recomputed,
      actualLoad: existing.actualLoad,
      unplannedLoad: existing.unplannedLoad,
      activityId: existing.activityId,
    };
    const changed = stableStringify(existing) !== stableStringify(after);
    return { date: existing.date, settled, before: existing, after, changed };
  });

  return {
    userId,
    weekPlanId: week.id,
    weekStart: week.weekStart,
    days,
    changed: days.some((d) => d.changed),
  };
}

/**
 * Writes a computed repair's days back onto the week row. A no-op when
 * nothing changed — the caller need not check `repair.changed` first, but
 * doing so avoids an unnecessary `updatedAt` bump.
 */
export async function applyWeekRepair(repair: WeekRepair): Promise<void> {
  if (!repair.changed) return;
  const days = repair.days.map((d) => d.after);
  await db
    .update(schema.weekPlans)
    .set({ days, updatedAt: new Date() })
    .where(eq(schema.weekPlans.id, repair.weekPlanId));
}

/** Every user with a currently-open week — the CLI's default when no
 *  `--user` is given. */
export async function usersWithOpenWeek(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: schema.weekPlans.userId })
    .from(schema.weekPlans)
    .where(eq(schema.weekPlans.status, "open"));
  return rows.map((r) => r.userId);
}

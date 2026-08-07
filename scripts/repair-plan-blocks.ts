/**
 * v0.45 repair: recompute an active plan's un-started training blocks from
 * the fixed periodize() (Tasks 3-5: the recovery cadence now carries across
 * phase boundaries instead of resetting at each one, the taper reads one
 * shared ladder from race/taper.ts instead of a flat 25%/week decay, and
 * each loading week is bounded against a CTL ramp trajectory). Athletes with
 * an active plan are still carrying skeletons the old code built.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Scope is MANDATORY: --user <id|email>, or --all spelled out in full. This
 * walks training_plans, and a DB-wide pass that also writes is the exact
 * shape that has previously put fabricated rows into real accounts here.
 *
 * ONLY weeks strictly after plan.currentWeek are touched. The current
 * week's block backs an OPEN week_plans row whose effectiveTarget is frozen
 * and gates the low-adherence safety rail in materialize.ts —
 * weekAdherencePct reads effectiveTarget, falling back to this block's
 * targetLoadTotal only when effectiveTarget is null (schema.ts:876-881).
 * Every earlier week is closed history with adherence already recorded
 * against its block. Rewriting either would corrupt real data to fix a
 * forecast for a sick or injured athlete.
 *
 * Never touches week_plans, activities, or effectiveTarget.
 * training_blocks has neither an updatedAt nor a createdAt column
 * (confirmed against src/lib/db/schema.ts) — nothing is stamped on the
 * rows this writes.
 */
import { fileURLToPath } from "node:url";
import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { periodize } from "@/lib/training-plan";
import { requirePlanSport } from "@/lib/plan-sport";
import { planConstraints } from "@/lib/week-plan/service";

export interface PlanBlockChange {
  planId: string;
  userId: string;
  weekNumber: number;
  before: {
    phase: string;
    targetLoadTotal: number | null;
    targetSessions: number | null;
  };
  after: { phase: string; targetLoadTotal: number; targetSessions: number };
}

export interface RepairPlanBlocksResult {
  plansChecked: number;
  changes: PlanBlockChange[];
}

/**
 * Core repair, importable by tests without the CLI's process.argv parsing
 * or process.exit side effects (see backfill-start-date-local.ts for the
 * same shape). `userId`, when given, scopes the underlying query itself —
 * never a post-fetch JS filter — so a caller (test or operator) scoped to
 * one user can never touch another's rows. Omit it only for a deliberate
 * whole-table --all run.
 */
export async function repairPlanBlocks(
  opts: { dryRun: boolean; userId?: string } = { dryRun: true }
): Promise<RepairPlanBlocksResult> {
  const plans = await db.query.trainingPlans.findMany({
    where: opts.userId
      ? and(
          eq(schema.trainingPlans.userId, opts.userId),
          eq(schema.trainingPlans.status, "active")
        )
      : eq(schema.trainingPlans.status, "active"),
    orderBy: asc(schema.trainingPlans.createdAt),
  });

  const changes: PlanBlockChange[] = [];

  for (const plan of plans) {
    // Read the plan's own constraints exactly as rolloverWeekPlan does
    // (week-plan/service.ts). Sport comes from constraints.sports[0], never
    // a trainingPlans.sport column (there isn't one) or raceType (free
    // text, no closed vocabulary) — same reasoning as service.ts's own
    // comment on this line.
    const constraints = planConstraints(plan.constraints);
    const sport = requirePlanSport(constraints.sports?.[0]);

    // Recomputed fresh, never read as authority — a stored skeleton is
    // exactly how these blocks went stale in the first place.
    const derived = periodize(
      plan.weeksTotal,
      plan.startingCtl ?? 0,
      constraints.daysPerWeek,
      constraints.hoursPerWeek,
      sport
    );

    // Strictly after the current week. See the module doc — this is the
    // boundary that protects real athlete data.
    const blocks = await db.query.trainingBlocks.findMany({
      where: and(
        eq(schema.trainingBlocks.planId, plan.id),
        gt(schema.trainingBlocks.weekNumber, plan.currentWeek)
      ),
      orderBy: asc(schema.trainingBlocks.weekNumber),
    });

    const toWrite: { id: string; d: (typeof derived)[number] }[] = [];
    for (const block of blocks) {
      const d = derived.find((b) => b.weekNumber === block.weekNumber);
      if (!d) continue;
      if (
        d.targetLoad === block.targetLoadTotal &&
        d.phase === block.phase &&
        d.targetSessions === block.targetSessions
      ) {
        continue;
      }

      toWrite.push({ id: block.id, d });
      changes.push({
        planId: plan.id,
        userId: plan.userId,
        weekNumber: block.weekNumber,
        before: {
          phase: block.phase,
          targetLoadTotal: block.targetLoadTotal,
          targetSessions: block.targetSessions,
        },
        after: {
          phase: d.phase,
          targetLoadTotal: d.targetLoad,
          targetSessions: d.targetSessions,
        },
      });
    }

    if (!opts.dryRun && toWrite.length > 0) {
      // One transaction per plan: every block here comes from the same
      // periodize() call, so they succeed or fail together. This also
      // requires DATABASE_DRIVER=pg — under the Neon HTTP driver
      // db.transaction() throws synchronously rather than silently
      // applying writes unwrapped, so a misconfigured run fails loud on
      // the first write instead of corrupting data quietly (same idiom as
      // repair-week-actuals.ts).
      await db.transaction(async (tx) => {
        for (const { id, d } of toWrite) {
          await tx
            .update(schema.trainingBlocks)
            .set({
              phase: d.phase,
              targetLoadTotal: d.targetLoad,
              targetSessions: d.targetSessions,
            })
            .where(eq(schema.trainingBlocks.id, id));
        }
      });
    }
  }

  return { plansChecked: plans.length, changes };
}

/**
 * Marks the two deliberate, operator-caused refusals this CLI throws
 * (missing scope, unresolvable --user) so the top-level catch can tell them
 * apart from an unexpected failure — a dropped connection, a constraint
 * violation, a bug reached inside periodize(). See that catch for the rule.
 */
class ScopeError extends Error {}

async function resolveUserId(
  arg: string
): Promise<{ id: string; email: string }> {
  const byId = await db.query.users.findFirst({
    where: eq(schema.users.id, arg),
  });
  if (byId) return { id: byId.id, email: byId.email };
  const byEmail = await db.query.users.findFirst({
    where: eq(schema.users.email, arg),
  });
  if (byEmail) return { id: byEmail.id, email: byEmail.email };
  throw new ScopeError(`no user matches ${arg}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const all = process.argv.includes("--all");
  const userArgIdx = process.argv.indexOf("--user");
  const userArg = userArgIdx === -1 ? null : process.argv[userArgIdx + 1];

  if (!userArg && !all) {
    throw new ScopeError(
      "scope required: --user <id|email>, or --all to mean every user"
    );
  }

  const user = userArg ? await resolveUserId(userArg) : null;
  console.log(
    `${apply ? "APPLYING" : "DRY RUN"} over ${
      user ? `user ${user.email} (${user.id})` : "every user"
    }\n`
  );

  const result = await repairPlanBlocks({ dryRun: !apply, userId: user?.id });

  // Lazy per-user headers, printed right before the first line that
  // actually belongs to that user — same principle as
  // repair-week-actuals.ts, so a --all run isn't a wall of headers for
  // users with nothing to change. The single-user case already has the
  // email from the scope resolution above; a --all run resolves it lazily,
  // once per user, only when there is something to print.
  const printedUsers = new Set<string>();
  const emailCache = new Map<string, string>();
  async function emailFor(userId: string): Promise<string> {
    if (user && user.id === userId) return user.email;
    const cached = emailCache.get(userId);
    if (cached) return cached;
    const row = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    const email = row?.email ?? userId;
    emailCache.set(userId, email);
    return email;
  }

  let totalDelta = 0;
  for (const c of result.changes) {
    if (!printedUsers.has(c.userId)) {
      printedUsers.add(c.userId);
      console.log(
        `user ${await emailFor(c.userId)} (${c.userId})  plan ${c.planId}`
      );
    }
    totalDelta += c.after.targetLoadTotal - (c.before.targetLoadTotal ?? 0);
    console.log(
      `  week ${String(c.weekNumber).padStart(2)}  ` +
        `${c.before.phase} → ${c.after.phase}  ` +
        `load ${c.before.targetLoadTotal} → ${c.after.targetLoadTotal}  ` +
        `sessions ${c.before.targetSessions} → ${c.after.targetSessions}`
    );
  }

  console.log(
    `\n${result.changes.length} block(s) ${
      apply ? "written" : "would change"
    }, net target load ${totalDelta >= 0 ? "+" : ""}${totalDelta} ` +
      `(${result.plansChecked} plan(s) checked)`
  );
  if (!apply && result.changes.length > 0) {
    console.log("Re-run with --apply to write.");
  }
}

// Guards the CLI entry point without `require.main` (unsafe under Vitest's
// ESM transform, which is why this file must be importable by its test
// without side effects) — import.meta.url works in both tsx and Vitest.
// Same idiom as backfill-start-date-local.ts and repair-corrupted-week.ts.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      // Two different audiences, two different errors (v0.45 Task 9
      // review, Important 2 follow-up):
      //   - ScopeError is an operator mistake this CLI deliberately
      //     refuses (no scope given, --user doesn't resolve). The
      //     operator needs a clear sentence, not a trace through this
      //     script's own argv parsing.
      //   - Anything else is unexpected — a dropped connection, a
      //     constraint violation, a bug in periodize() reaching this far
      //     — and for a tool that writes plan data against a live
      //     database, swallowing that stack would be a real
      //     debuggability regression. Those print in full, same as
      //     repair-week-actuals.ts, repair-corrupted-week.ts and
      //     backfill-start-date-local.ts's plain `console.error(e)`.
      console.error(e instanceof ScopeError ? e.message : e);
      process.exit(1);
    }
  );
}

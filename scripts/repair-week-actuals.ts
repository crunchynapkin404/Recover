/**
 * v0.44 repair: re-derive every stored week's day bookings from the
 * activities table, and recompute the adherence those bookings feed.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Scope is MANDATORY: --user <id|email>, or --all spelled out in full. This
 * walks week_plans, and a DB-wide pass that also writes is the exact shape
 * that has previously put fabricated rows into real accounts in this repo.
 *
 * The live case: the week of 2026-07-27 closed at actualLoad 314 against a
 * real 783, because three of its days sat in status `completed` — set by the
 * app's own "Mark done" button — and neither booking branch covered that
 * status.
 *
 * Only CLOSED weeks are touched. The one "open" row a user has is the week
 * they're currently mid-way through; runDailyAdaptation (fixed earlier in
 * v0.44) already re-books every past day of it on its own next run, and
 * booking it here too would mean writing days that haven't happened yet —
 * `weekEnd` for an open week is this week's Sunday, which can be in the
 * future. Never touches `activities`. Never re-materialises or re-targets a
 * week: correcting history is in scope, rewriting a week the athlete is
 * midway through is not.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  bookWeekActuals,
  deriveDayActuals,
  weekActuals,
} from "@/lib/week-plan/actuals";
import { addDaysYmd } from "@/lib/week-plan/service";
import { weekAdherencePct } from "@/lib/week-plan/volume";
import type { DaySlot } from "@/lib/week-plan/types";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const userArgIdx = process.argv.indexOf("--user");
const USER_ARG = userArgIdx === -1 ? null : process.argv[userArgIdx + 1];

type UserRef = { id: string; email: string };

async function resolveUsers(): Promise<UserRef[]> {
  if (USER_ARG) {
    const byId = await db.query.users.findFirst({
      where: eq(schema.users.id, USER_ARG),
    });
    if (byId) return [{ id: byId.id, email: byId.email }];
    const byEmail = await db.query.users.findFirst({
      where: eq(schema.users.email, USER_ARG),
    });
    if (byEmail) return [{ id: byEmail.id, email: byEmail.email }];
    throw new Error(`no user matches ${USER_ARG}`);
  }
  if (ALL) {
    const rows = await db.query.users.findMany();
    return rows.map((u) => ({ id: u.id, email: u.email }));
  }
  throw new Error(
    "scope required: --user <id|email>, or --all to mean every user"
  );
}

async function main() {
  // One timestamp for the whole run, threaded through every write — same
  // pattern as rolloverWeekPlan's `now` parameter, rather than a fresh
  // `new Date()` per row.
  const now = new Date();
  const users = await resolveUsers();
  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} over ${users.length} user(s)\n`
  );

  let weeksChanged = 0;
  let totalDelta = 0;

  for (const user of users) {
    const weeks = await db.query.weekPlans.findMany({
      // Closed weeks only — see the module doc for why the open week is
      // out of scope.
      where: and(
        eq(schema.weekPlans.userId, user.id),
        eq(schema.weekPlans.status, "closed")
      ),
      orderBy: asc(schema.weekPlans.weekStart),
    });

    // Printed lazily, right before the first line that actually belongs to
    // this user, so a --all run isn't a wall of headers for users with
    // nothing to change — but every printed week/day line is still
    // unambiguously attributed to an account. See the module doc: a
    // DB-wide pass writing into the wrong athlete's account is exactly the
    // failure mode this guards against.
    let headerPrinted = false;

    for (const row of weeks) {
      const stored = row.days as DaySlot[];
      const weekEnd = addDaysYmd(row.weekStart, 6);
      const actuals = await deriveDayActuals(user.id, row.weekStart, weekEnd);
      const booked = bookWeekActuals(stored, actuals, weekEnd);

      if (JSON.stringify(booked) === JSON.stringify(stored)) continue;

      const before = weekActuals(stored);
      const after = weekActuals(booked);
      weeksChanged += 1;
      totalDelta += after.actualLoad - before.actualLoad;

      if (!headerPrinted) {
        console.log(`user ${user.email} (${user.id})`);
        headerPrinted = true;
      }
      console.log(
        `${row.weekStart} (${row.status})  load ${before.actualLoad} → ${after.actualLoad}`
      );
      for (let i = 0; i < booked.length; i++) {
        const b = booked[i];
        const s = stored[i];
        const sLoad = (s.actualLoad ?? 0) + (s.unplannedLoad ?? 0);
        const bLoad = (b.actualLoad ?? 0) + (b.unplannedLoad ?? 0);
        // Load is the number that feeds weekActuals/adherence, but booking
        // also rewrites activityId — print the line whenever either changed
        // so a day whose activity was re-attributed without moving the load
        // total (e.g. a `completed` day the old code never stamped an
        // activityId onto) still shows up instead of vanishing between the
        // week-level total and a silent per-day write.
        if (sLoad !== bLoad || b.activityId !== s.activityId) {
          console.log(
            `    ${b.date}  ${s.status.padEnd(9)}  ${sLoad} → ${bLoad}` +
              (b.activityId !== s.activityId
                ? `  (activity ${s.activityId ?? "none"} → ${b.activityId ?? "none"})`
                : "")
          );
        }
      }

      // Matched on skeletonWeek, exactly as rolloverWeekPlan does
      // (service.ts:210-214, via the unique index on planId+weekNumber). A
      // plan has one block per week; matching on planId alone would write
      // this week's adherence onto another week.
      const block = await db.query.trainingBlocks.findFirst({
        where: and(
          eq(schema.trainingBlocks.planId, row.planId),
          eq(schema.trainingBlocks.weekNumber, row.skeletonWeek)
        ),
      });
      const adherencePct = weekAdherencePct({
        effectiveTarget: row.effectiveTarget,
        blockTarget: block?.targetLoadTotal ?? null,
        actualLoad: after.actualLoad,
      });
      console.log(`    adherence → ${adherencePct}%`);

      if (APPLY) {
        // One transaction for both writes. Without it, a process death
        // between the two leaves `training_blocks` stale while `days`
        // already matches the re-derived booking — the change gate above
        // compares only `days`, so a re-run would see nothing to do and
        // that staleness would never self-heal. See src/lib/sync/*-sync.ts,
        // src/lib/race/debrief.ts and src/lib/debrief/ride-review.ts for the
        // same `db.transaction` idiom elsewhere in this codebase.
        //
        // This relies on `db.transaction()` being available, which in turn
        // requires DATABASE_DRIVER=pg. That is not optional in any real
        // deployment of this app (see docs/DEPLOY-VERCEL.md's "mandatory,
        // not optional" and docs/SELF-HOSTING.md) — the scheduler already
        // depends on it for advisory locks. Under the Neon HTTP driver
        // (DATABASE_DRIVER unset) `db.transaction()` throws synchronously
        // ("No transactions support in neon-http driver") rather than
        // silently falling back to unwrapped writes, so a misconfigured run
        // fails loud on the first write instead of corrupting data quietly.
        await db.transaction(async (tx) => {
          await tx
            .update(schema.weekPlans)
            .set({ days: booked, updatedAt: now })
            .where(eq(schema.weekPlans.id, row.id));
          if (block) {
            await tx
              .update(schema.trainingBlocks)
              .set({
                actualLoad: after.actualLoad,
                actualSessions: after.actualSessions,
                adherencePct,
              })
              .where(eq(schema.trainingBlocks.id, block.id));
          }
        });
      }
    }
  }

  console.log(
    `\n${weeksChanged} week(s) ${APPLY ? "written" : "would change"}, net load ${totalDelta >= 0 ? "+" : ""}${totalDelta}`
  );
  if (!APPLY && weeksChanged > 0) console.log("Re-run with --apply to write.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);

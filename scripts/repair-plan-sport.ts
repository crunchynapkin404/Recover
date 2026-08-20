/**
 * v0.42 repair: regenerate any active plan whose stored sport disagrees with
 * its race, or whose workouts are the wrong sport entirely.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * The live case: plan 34a69f25 for a gran fondo held
 * constraints.sports = ["Ride"] and 24 running sessions.
 */
import { fileURLToPath } from "node:url";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import {
  inferPlanSport,
  requirePlanSport,
  type PlanSport,
} from "@/lib/plan-sport";
import { generateTrainingPlan } from "@/lib/training-plan";

/**
 * The race this plan is for, and the sport it therefore wants.
 *
 * `training_plans.race_id` is NOT reliably populated. The v0.42 spec assumed
 * it was — "every plan already has a race, so the authority is always
 * available" — and that is false for existing data: all five plans on the
 * production database have `race_id` NULL, including the very gran-fondo plan
 * this script exists to repair. Skipping on a null `race_id` therefore
 * swallowed exactly the case it was written for.
 *
 * So fall back, in order:
 *   1. the linked race, when there is one — its `sport` is authoritative
 *   2. a race of this athlete's on the plan's own `race_date`. Plans are
 *      built toward a date, and `training_plans.race_date` is copied from the
 *      race at creation, so an exact date match is a strong link rather than
 *      a guess. Regenerating then passes `raceId`, which repairs the missing
 *      linkage as a side effect.
 *   3. the plan's own `race_type` through the exact lookup — this column
 *      holds the plan tool's closed enum value (`gran_fondo`, `marathon`),
 *      not free text, so the lookup places it or nothing does.
 *
 * Returns null when every avenue misses, which is a skip rather than a guess.
 */
async function resolveTarget(plan: typeof schema.trainingPlans.$inferSelect) {
  if (plan.raceId) {
    const race = await db.query.races.findFirst({
      where: eq(schema.races.id, plan.raceId),
    });
    if (race)
      return { race, want: requirePlanSport(race.sport), via: "linked race" };
  }
  const byDate = await db.query.races.findFirst({
    where: and(
      eq(schema.races.userId, plan.userId),
      eq(schema.races.date, plan.raceDate)
    ),
  });
  if (byDate) {
    return {
      race: byDate,
      want: requirePlanSport(byDate.sport),
      via: `race matched on date ${plan.raceDate}`,
    };
  }
  const fromType = inferPlanSport(plan.raceType);
  if (fromType) {
    return {
      race: null,
      want: fromType,
      via: `plan race_type ${plan.raceType}`,
    };
  }
  return null;
}

export type PlanSportOutcome =
  | { planId: string; kind: "skipped_no_target"; raceTypeRaw: string | null }
  // A second A-race is on record (migration 0042's firstRaceId).
  // generateTrainingPlan below only ever takes a single
  // raceId/raceType/raceDate — it has no way to carry a firstRace through —
  // so regenerating here would silently collapse the athlete's two-arc plan
  // (arc + recovery + arc, periodize()'s composition) into one flattened
  // arc. Refused rather than guessed at. Same defect class as
  // repair-plan-blocks.ts before its own FIX 4.
  | { planId: string; kind: "refused_two_race" }
  | { planId: string; kind: "already_correct"; want: PlanSport; via: string }
  | {
      planId: string;
      kind: "regenerate";
      want: PlanSport;
      via: string;
      raceName: string;
      sportsFound: string[];
      applied: boolean;
    };

export interface RepairPlanSportResult {
  outcomes: PlanSportOutcome[];
}

/**
 * Core repair, importable by tests without the CLI's process.argv parsing
 * or process.exit side effects — same shape as repairPlanBlocks
 * (repair-plan-blocks.ts). No console output here; `main()` below does all
 * the printing from the returned outcomes, so this stays a plain,
 * inspectable result.
 */
export async function repairPlanSport(opts: {
  apply: boolean;
}): Promise<RepairPlanSportResult> {
  const plans = await db.query.trainingPlans.findMany({
    where: eq(schema.trainingPlans.status, "active"),
  });
  const outcomes: PlanSportOutcome[] = [];

  for (const plan of plans) {
    if (plan.firstRaceId) {
      outcomes.push({ planId: plan.id, kind: "refused_two_race" });
      continue;
    }

    const target = await resolveTarget(plan);
    if (!target) {
      outcomes.push({
        planId: plan.id,
        kind: "skipped_no_target",
        raceTypeRaw: plan.raceType,
      });
      continue;
    }
    const { race, want, via } = target;
    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, plan.id),
    });
    const sports = new Set(
      blocks.flatMap((b) =>
        (b.workouts as { sport: string }[]).map((w) => w.sport)
      )
    );
    // F4: flagging a triathlon plan only for a sport OUTSIDE {Swim,Bike,Run}
    // cannot catch this release's own headline bug — a triathlon race whose
    // plan was wrongly built pure-Run has sports = {"Run"}, a *subset* of
    // {Swim,Bike,Run}, which passed that check silently. generateTriathlonWorkouts
    // unconditionally emits a Bike, a Run and a Swim session every single
    // week regardless of phase or session count (see training-plan.ts) — so
    // a correctly-generated triathlon plan's blocks always contain all
    // three disciplines somewhere. A plan missing any one of them cannot be
    // a real triathlon plan, so "wrong" now means: an out-of-set sport
    // appears, OR the plan does not span all three disciplines.
    const wrong =
      want === "Triathlon"
        ? [...sports].some((s) => !["Swim", "Bike", "Run"].includes(s)) ||
          !["Swim", "Bike", "Run"].every((s) => sports.has(s))
        : [...sports].some((s) => s !== want);
    if (!wrong) {
      outcomes.push({ planId: plan.id, kind: "already_correct", want, via });
      continue;
    }

    if (opts.apply) {
      await generateTrainingPlan({
        userId: plan.userId,
        // When a race was found, regenerate against IT — passing raceId makes
        // generateTrainingPlan read race.sport directly and also repairs the
        // missing plan→race link. Without one, fall back to the plan's own
        // fields; generateTrainingPlan will create a race and link that.
        raceType: race?.raceType ?? plan.raceType,
        raceDate: race?.date ?? plan.raceDate,
        ...(race ? { raceId: race.id } : {}),
        daysPerWeek:
          (plan.constraints as { daysPerWeek?: number } | null)?.daysPerWeek ??
          5,
        hoursPerWeek:
          (plan.constraints as { hoursPerWeek?: number } | null)
            ?.hoursPerWeek ?? 8,
      });
    }
    outcomes.push({
      planId: plan.id,
      kind: "regenerate",
      want,
      via,
      raceName: race?.name ?? plan.title,
      sportsFound: [...sports],
      applied: opts.apply,
    });
  }

  return { outcomes };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const { outcomes } = await repairPlanSport({ apply });
  for (const o of outcomes) {
    const short = o.planId.slice(0, 8);
    switch (o.kind) {
      case "refused_two_race":
        console.log(
          `plan ${short}: has a second A-race on record (firstRaceId set) — this script only knows how to regenerate a single-race plan and would collapse the two-race arc into one, so it refuses to touch this plan`
        );
        break;
      case "skipped_no_target":
        console.log(
          `plan ${short}: no race, and race_type ${JSON.stringify(o.raceTypeRaw)} names no sport — skipped`
        );
        break;
      case "already_correct":
        console.log(
          `plan ${short}: already ${o.want} (via ${o.via}) — no change`
        );
        break;
      case "regenerate":
        console.log(
          `plan ${short} (${o.raceName}): wants ${o.want} via ${o.via}, workouts are ${o.sportsFound.join("/")} — REGENERATE`
        );
        if (o.applied) console.log(`  regenerated`);
        break;
    }
  }
}

// Guards the CLI entry point without `require.main` (unsafe under Vitest's
// ESM transform, which is why this file must be importable by its test
// without side effects) — import.meta.url works in both tsx and Vitest.
// Same idiom as repair-plan-blocks.ts and backfill-start-date-local.ts.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    }
  );
}

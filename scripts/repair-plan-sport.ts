/**
 * v0.42 repair: regenerate any active plan whose stored sport disagrees with
 * its race, or whose workouts are the wrong sport entirely.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * The live case: plan 34a69f25 for a gran fondo held
 * constraints.sports = ["Ride"] and 24 running sessions.
 */
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { inferPlanSport, requirePlanSport } from "@/lib/plan-sport";
import { generateTrainingPlan } from "@/lib/training-plan";

const APPLY = process.argv.includes("--apply");

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

async function main() {
  const plans = await db.query.trainingPlans.findMany({
    where: eq(schema.trainingPlans.status, "active"),
  });
  for (const plan of plans) {
    const target = await resolveTarget(plan);
    if (!target) {
      console.log(
        `plan ${plan.id.slice(0, 8)}: no race, and race_type ${JSON.stringify(plan.raceType)} names no sport — skipped`
      );
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
      console.log(
        `plan ${plan.id.slice(0, 8)}: already ${want} (via ${via}) — no change`
      );
      continue;
    }
    console.log(
      `plan ${plan.id.slice(0, 8)} (${race?.name ?? plan.title}): wants ${want} via ${via}, workouts are ${[...sports].join("/")} — REGENERATE`
    );
    if (!APPLY) continue;
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
        (plan.constraints as { daysPerWeek?: number } | null)?.daysPerWeek ?? 5,
      hoursPerWeek:
        (plan.constraints as { hoursPerWeek?: number } | null)?.hoursPerWeek ??
        8,
    });
    console.log(`  regenerated`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);

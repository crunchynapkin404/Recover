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
import { eq } from "drizzle-orm";
import { requirePlanSport } from "@/lib/plan-sport";
import { generateTrainingPlan } from "@/lib/training-plan";

const APPLY = process.argv.includes("--apply");

async function main() {
  const plans = await db.query.trainingPlans.findMany({
    where: eq(schema.trainingPlans.status, "active"),
  });
  for (const plan of plans) {
    if (!plan.raceId) {
      console.log(`plan ${plan.id.slice(0, 8)}: no race — skipped`);
      continue;
    }
    const race = await db.query.races.findFirst({
      where: eq(schema.races.id, plan.raceId),
    });
    if (!race) continue;
    const want = requirePlanSport(race.sport);
    const blocks = await db.query.trainingBlocks.findMany({
      where: eq(schema.trainingBlocks.planId, plan.id),
    });
    const sports = new Set(
      blocks.flatMap((b) =>
        (b.workouts as { sport: string }[]).map((w) => w.sport)
      )
    );
    // A triathlon plan legitimately holds three sports; only flag a plan
    // whose workouts contain a sport the race's own discipline cannot
    // produce.
    const wrong =
      want === "Triathlon"
        ? [...sports].some((s) => !["Swim", "Bike", "Run"].includes(s))
        : [...sports].some((s) => s !== want);
    if (!wrong) {
      console.log(`plan ${plan.id.slice(0, 8)}: already ${want} — no change`);
      continue;
    }
    console.log(
      `plan ${plan.id.slice(0, 8)} (${race.name}): race says ${want}, workouts are ${[...sports].join("/")} — REGENERATE`
    );
    if (!APPLY) continue;
    await generateTrainingPlan({
      userId: plan.userId,
      raceType: race.raceType,
      raceDate: race.date,
      raceId: race.id,
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

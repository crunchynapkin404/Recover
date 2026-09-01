/**
 * Seed an owner whose plan is CYCLING, so the structured-workout surface has
 * something to photograph.
 *
 * Usage:
 *   OWNER_EMAIL=cycling-owner@recover.local OWNER_PASSWORD=... \
 *     npx tsx scripts/seed-cycling-owner.ts
 *
 * WHY A SEPARATE ACCOUNT, NOT A CHANGE TO THE DEMO OWNER'S PLAN.
 * `src/lib/interval/` answers cycling days only, and every other seeded plan
 * is a marathon — `seed-confirmed-race.ts` and `seed-two-race.ts` both create
 * a Run race, and the RACE decides the plan's sport (previewTrainingPlan, "the
 * race decides the sport (v0.42)"). So v0.126.0 shipped with 100 capture PNGs
 * and an axe ratchet reporting `0 confirmed`, not one of which contained the
 * workout name, the derived line, the interval profile or either action: a
 * cycling-only feature was structurally unphotographable.
 *
 * Making the demo owner's plan cycling would have fixed that and broken far
 * more: that marathon plan drives train-race-pacing, train-fitness, the race
 * chip, threshold pace and Today's session cards. A separate account on its
 * own throwaway Postgres cannot collide with the demo owner by construction —
 * which is the reasoning `.github/workflows/surfaces.yml` already records for
 * `capture-first-run`, and it applies here unchanged. Two fixtures that CAN
 * clash is worse than two that structurally cannot.
 *
 * Account creation copies scripts/seed-fresh-owner.ts exactly: public signup
 * is disabled (invite-only), so this builds its own Better Auth instance with
 * signup enabled against the same database rather than hand-inserting a
 * `users` row with a password hash produced some other way.
 *
 * Refuses loudly if the account already carries a plan for a NON-cycling
 * race: a polluted fixture would make `train-workout` capture the ordinary
 * Train tab under the right name, which is the exact failure this account
 * exists to prevent, and no test would catch it.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import {
  previewTrainingPlan,
  confirmTrainingPlan,
} from "../src/lib/training-plan";
import { getOpenWeekPlan } from "../src/lib/week-plan/service";
import { workoutForDay } from "../src/lib/interval/for-day";

const DAY_MS = 86_400_000;
/** Far enough out that the plan is in base phase, where the week is ordinary. */
const RACE_GAP_DAYS = 84;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function ensureUser(email: string, password: string): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (existing) {
    if (existing.role !== "owner") {
      await db
        .update(schema.users)
        .set({ role: "owner" })
        .where(eq(schema.users.id, existing.id));
    }
    return existing.id;
  }

  const seedAuth = betterAuth({
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
    emailAndPassword: { enabled: true },
  });
  const result = await seedAuth.api.signUpEmail({
    body: { email, password, name: "Cycling Athlete" },
  });
  await db
    .update(schema.users)
    .set({ role: "owner", emailVerified: true })
    .where(eq(schema.users.id, result.user.id));
  return result.user.id;
}

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) {
    console.error("OWNER_EMAIL and OWNER_PASSWORD env vars are required.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("OWNER_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const userId = await ensureUser(email, password);

  const wrongSport = await db.query.races.findFirst({
    where: eq(schema.races.userId, userId),
  });
  if (wrongSport && wrongSport.sport !== "Bike") {
    console.error(
      `Refusing to continue: ${email} already has a ${wrongSport.sport} race, ` +
        "and the race decides the plan's sport. This account exists so the " +
        "train-workout surface photographs a CYCLING day; a non-cycling plan " +
        "here would capture the ordinary Train tab under that name and no " +
        "test would catch it. Use a genuinely separate account."
    );
    process.exit(1);
  }

  const raceDate = ymd(new Date(Date.now() + RACE_GAP_DAYS * DAY_MS));
  let raceId = wrongSport?.id;
  if (!raceId) {
    const [row] = await db
      .insert(schema.races)
      .values({
        userId,
        name: "Gran Fondo (demo)",
        raceType: "gran_fondo",
        sport: "Bike",
        date: raceDate,
        priority: "A",
        status: "upcoming",
        eventDays: 1,
        distanceKm: 120,
        elevationM: 1800,
      })
      .returning();
    raceId = row.id;
  }

  const result = await previewTrainingPlan({
    userId,
    raceType: "gran_fondo",
    raceDate,
    raceIds: [raceId],
    title: "Gran fondo plan (demo)",
    daysPerWeek: 5,
    hoursPerWeek: 8,
  });
  if (!result.ok) {
    console.error(`previewTrainingPlan refused: ${result.reason}`);
    process.exit(1);
  }

  const confirmed = await confirmTrainingPlan(userId, result.preview.planId);
  if (!confirmed.ok) {
    console.error(`confirmTrainingPlan refused: ${confirmed.reason}`);
    process.exit(1);
  }

  // Self-check, the same shape seed-confirmed-race.ts uses for pacing: prove
  // the state this seed exists to produce actually came out. "No error" is
  // not the same as "a cycling day the library answers", and if this account
  // ever stops producing one the `train-workout` surface would capture the
  // ordinary Train tab under a name promising a workout — which is the entire
  // failure this account was created to close. Fail here, where the message
  // can say why, rather than in a capture that can only say what it saw.
  const week = await getOpenWeekPlan(userId);
  if (!week) {
    console.error("Plan confirmed, but there is no open week. Refusing.");
    process.exit(1);
  }
  const answered = week.days.flatMap((d) =>
    d.workouts.map((w) => workoutForDay(w, d.date))
  );
  const hits = answered.filter(Boolean).length;
  if (hits === 0) {
    const shape = week.days
      .flatMap((d) =>
        d.workouts.map((w) => `${w.sport}/${w.purpose}/${w.durationMins}m`)
      )
      .join(", ");
    console.error(
      "Plan confirmed, but NOT ONE of its sessions produced a structured " +
        "workout, so train-workout would have nothing to photograph. The " +
        `week is: ${shape || "(no sessions at all)"}. Either the library no ` +
        "longer covers these durations, or the plan is not cycling."
    );
    process.exit(1);
  }

  console.log(
    `Cycling owner ${email} seeded; race ${raceDate}; ` +
      `${hits} of ${answered.length} sessions have a structured workout.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

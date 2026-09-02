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

/**
 * Past races with results, so `train-races` has something to photograph.
 *
 * WITHOUT THIS THE SURFACE IS BLANK. Counted in production on 2026-09-02:
 * `races.resultActivityId` has never been non-null there, not once, so the
 * comparison v0.129.0 computes and v0.130.0 renders has never appeared on any
 * screen or in any capture. A seeded athlete is the only way to see it before
 * a real race produces one.
 *
 * THREE of the four refusals are seeded, not four. The Races sheet shows the
 * three most recent raced events (`RACE_RESULTS_SHOWN` in train/page.tsx), so
 * a fourth would push one off the surface it exists to photograph — and
 * widening a product bound to suit a fixture is the guard driving the
 * coaching. The one left unseeded is "a bike result with no power", chosen
 * because it is a plain `missingInput` string, where the other three each
 * render something with more to get wrong: a full comparison, the Strava
 * firewall's sentence, and a mismatch message that formats two distances.
 */
async function seedRaceResults(userId: string): Promise<void> {
  const past = (days: number) => new Date(Date.now() - days * DAY_MS);

  // AN FTP, WITHOUT WHICH THIS WHOLE FIXTURE PHOTOGRAPHS ONE STATE.
  //
  // Found by opening the first capture: all three seeded races rendered the
  // identical line, "Race pacing: Needs your FTP · Set it". `racePacing`
  // refuses before it ever looks at the result, so `comparePacing` passes
  // that refusal through and every row says the same thing — three rows of
  // evidence for a state that needed one. The seeded athlete had no anchor
  // of any kind, which is also not what a cycling owner looks like.
  await db
    .insert(schema.bodyPrefs)
    .values({ userId, ftpWatts: 250 })
    .onConflictDoNothing();

  const cases = [
    {
      // AVAILABLE. 90 km at 214 W against a target the model recomputes from
      // race-day anchors — the state the whole feature exists for.
      name: "Spring Classic (demo)",
      days: 30,
      provider: "intervals_icu" as const,
      distanceM: 90_000,
      avgPower: 214,
      raceDistanceKm: 90,
    },
    {
      // NOT_APPLICABLE — the Strava firewall (Nov 2024 API agreement). Linked
      // as bookkeeping, never scored. The refusal with a legal obligation
      // behind it, so the one most worth having a picture of.
      name: "Summer Century (demo)",
      days: 60,
      provider: "strava" as const,
      distanceM: 160_000,
      avgPower: 198,
      raceDistanceKm: 160,
    },
    {
      // NOT_APPLICABLE — the recorded result is nothing like the race's own
      // distance. A DNF, or the wrong activity linked. Its copy names both
      // figures, which is the part that can silently stop formatting.
      name: "Mountain Marathon (demo)",
      days: 90,
      provider: "intervals_icu" as const,
      distanceM: 42_000,
      avgPower: 205,
      raceDistanceKm: 120,
    },
  ];

  for (const c of cases) {
    const when = past(c.days);
    const date = ymd(when);
    const existing = await db.query.races.findFirst({
      where: eq(schema.races.name, c.name),
    });
    if (existing?.resultActivityId) continue;

    const [activity] = await db
      .insert(schema.activities)
      .values({
        userId,
        provider: c.provider,
        externalId: `seed-result-${c.days}`,
        sport: "Ride",
        startDate: new Date(date + "T09:00:00"),
        durationS: 11_000,
        distanceM: c.distanceM,
        avgPower: c.avgPower,
        load: 210,
      })
      .onConflictDoNothing()
      .returning();
    const resultId =
      activity?.id ??
      (
        await db.query.activities.findFirst({
          where: eq(schema.activities.externalId, `seed-result-${c.days}`),
        })
      )?.id;
    if (!resultId) continue;

    if (existing) {
      await db
        .update(schema.races)
        .set({ resultActivityId: resultId, status: "completed" })
        .where(eq(schema.races.id, existing.id));
      continue;
    }
    await db.insert(schema.races).values({
      userId,
      name: c.name,
      raceType: "gran_fondo",
      sport: "Bike",
      date,
      priority: "B",
      status: "completed",
      eventDays: 1,
      distanceKm: c.raceDistanceKm,
      elevationM: 900,
      resultActivityId: resultId,
      debriefedAt: when,
    });
  }
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

  await seedRaceResults(userId);

  // Self-check, the same shape as the structured-workout one above: prove the
  // state came out, rather than trusting that no error means it did. A blank
  // `train-races` capture would photograph an empty sheet under a name
  // promising race results — the exact failure `train-workout` was created to
  // close, repeated one surface along.
  const raced = await db.query.races.findMany({
    where: eq(schema.races.userId, userId),
  });
  const withResult = raced.filter((r) => r.resultActivityId != null).length;
  if (withResult < 3) {
    console.error(
      `Seeded, but only ${withResult} of ${raced.length} races carry a result. ` +
        "train-races would photograph a sheet with nothing in it. Refusing."
    );
    process.exit(1);
  }

  console.log(
    `Cycling owner ${email} seeded; race ${raceDate}; ` +
      `${hits} of ${answered.length} sessions have a structured workout; ` +
      `${withResult} past races carry a result.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

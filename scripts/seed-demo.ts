/**
 * Seed a demo account with ~90 days of plausible wellness + training data,
 * then backfill daily_metrics through the real readiness engine. Built for
 * screenshots and demos — never for production data.
 *
 * Guard: refuses to run unless SEED_DEMO=1.
 * Idempotent: a fixed-seed PRNG generates identical values on every run and
 * all writes are upserts keyed on (user,date) / (user,provider,externalId).
 *
 * Usage:
 *   SEED_DEMO=1 npm run db:seed-demo
 *   SEED_DEMO=1 DEMO_EMAIL=demo@example.com DEMO_DAYS=120 npx tsx scripts/seed-demo.ts
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { computeDailyMetrics } from "../src/lib/metrics";

const DAY_MS = 24 * 60 * 60 * 1000;

// Deterministic PRNG so reruns upsert the exact same rows.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

type Phase = "base" | "hard_block" | "recovery" | "build";

/** Training story: steady base → 2-week overload → recovery week → rebuild. */
function phaseOf(i: number, days: number): Phase {
  const blockStart = Math.floor(days * 0.4);
  if (i >= blockStart && i < blockStart + 14) return "hard_block";
  if (i >= blockStart + 14 && i < blockStart + 21) return "recovery";
  if (i >= blockStart + 21) return "build";
  return "base";
}

interface DayWorkout {
  sport: string;
  name: string;
  durationS: number;
  distanceM: number;
  load: number;
  avgHr: number;
  avgPower: number | null;
  elevationM: number;
}

function workoutsFor(
  dow: number,
  phase: Phase,
  rand: () => number
): DayWorkout[] {
  const factor =
    phase === "hard_block" ? 1.3 : phase === "recovery" ? 0.45 : 1.0;
  const jitter = () => 0.9 + rand() * 0.2;

  const ride = (
    name: string,
    mins: number,
    load: number,
    watts: number,
    hr: number
  ): DayWorkout => {
    const f = factor * jitter();
    return {
      sport: "Ride",
      name,
      durationS: Math.round(mins * 60 * f),
      distanceM: Math.round(mins * 500 * f),
      load: round1(load * f),
      avgHr: Math.round(hr + (f - 1) * 10),
      avgPower: Math.round(watts * (0.95 + rand() * 0.1)),
      elevationM: Math.round(mins * 6 * f),
    };
  };
  const run = (
    name: string,
    mins: number,
    load: number,
    hr: number
  ): DayWorkout => {
    const f = factor * jitter();
    return {
      sport: "Run",
      name,
      durationS: Math.round(mins * 60 * f),
      distanceM: Math.round(mins * 185 * f),
      load: round1(load * f),
      avgHr: Math.round(hr + (f - 1) * 10),
      avgPower: null,
      elevationM: Math.round(mins * 2 * f),
    };
  };

  switch (dow) {
    case 2: // Tuesday
      return [
        phase === "recovery"
          ? ride("Recovery spin", 45, 25, 145, 118)
          : ride("Threshold intervals 4x8", 75, 85, 235, 152),
      ];
    case 4: // Thursday
      return [
        phase === "recovery"
          ? run("Easy jog", 30, 20, 128)
          : run("Tempo run", 50, 60, 156),
      ];
    case 6: // Saturday
      return [
        phase === "hard_block"
          ? ride("Long ride w/ climbs", 210, 160, 205, 142)
          : ride("Long endurance ride", 165, 115, 190, 135),
      ];
    case 0: // Sunday
      return [run("Long easy run", 70, 45, 138)];
    case 3: // Wednesday — sometimes an easy spin
      return rand() < 0.5 ? [ride("Coffee spin", 40, 22, 140, 115)] : [];
    default:
      return [];
  }
}

const NOTES: Record<Phase, string[]> = {
  base: [
    "Legs felt springy on the climbs today.",
    "Good rhythm all week — sleep has been consistent.",
    "Slight headwind on the loop, kept it steady.",
  ],
  hard_block: [
    "Second week of the block. Everything is heavy.",
    "Hit the numbers but the last interval was a fight.",
    "Woke up before the alarm, legs still sore from Saturday.",
  ],
  recovery: [
    "Deliberately easy. HRV finally trending back up.",
    "Slept 9 hours. Feeling human again.",
  ],
  build: [
    "Rested and rebuilding — power feels better than before the block.",
    "New 8-min best on the usual segment.",
  ],
};

const TAGS: Record<Phase, string[][]> = {
  base: [["consistent"], ["outdoor"]],
  hard_block: [["training-camp"], ["sore-legs"], ["big-week"]],
  recovery: [["recovery-week"], ["slept-in"]],
  build: [["feeling-fresh"], ["pr"]],
};

async function findOrCreateDemoUser(
  email: string,
  password: string,
  name: string
): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (existing) {
    console.log(`Demo user ${email} already exists — reseeding data.`);
    return existing.id;
  }

  // Public signup is invite-only; build a local auth instance like seed-owner.
  const seedAuth = betterAuth({
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
    emailAndPassword: { enabled: true },
  });
  const result = await seedAuth.api.signUpEmail({
    body: { email, password, name },
  });
  await db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.id, result.user.id));
  console.log(`Demo user created: ${email}`);
  return result.user.id;
}

async function main() {
  if (process.env.SEED_DEMO !== "1") {
    console.error(
      "Refusing to run: this seeds fake demo data. Set SEED_DEMO=1 to confirm."
    );
    process.exit(1);
  }

  const email = process.env.DEMO_EMAIL ?? "demo@recover.local";
  const password = process.env.DEMO_PASSWORD ?? "recover-demo";
  const name = process.env.DEMO_NAME ?? "Demo Athlete";
  const days = Number(process.env.DEMO_DAYS ?? 90);

  const userId = await findOrCreateDemoUser(email, password, name);
  const rand = mulberry32(20260714);

  const start = new Date(Date.now() - (days - 1) * DAY_MS);
  const startDate = ymd(start);

  // Mid-season starting fitness; CTL/ATL evolve as standard 42d/7d EMAs of load.
  let ctl = 55;
  let atl = 55;
  let weight = 72.5;
  let activityCount = 0;

  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const date = ymd(d);
    const phase = phaseOf(i, days);
    const workouts = workoutsFor(d.getUTCDay(), phase, rand);

    let dayLoad = 0;
    for (let w = 0; w < workouts.length; w++) {
      const wk = workouts[w];
      dayLoad += wk.load;
      const startDateTime = new Date(d.getTime() + (8 + w * 5) * 3600 * 1000);
      await db
        .insert(schema.activities)
        .values({
          userId,
          provider: "manual",
          externalId: `demo-${date}-${w + 1}`,
          startDate: startDateTime,
          sport: wk.sport,
          name: wk.name,
          durationS: wk.durationS,
          distanceM: wk.distanceM,
          load: wk.load,
          avgHr: wk.avgHr,
          avgPower: wk.avgPower,
          elevationM: wk.elevationM,
        })
        .onConflictDoUpdate({
          target: [
            schema.activities.userId,
            schema.activities.provider,
            schema.activities.externalId,
          ],
          set: {
            startDate: startDateTime,
            sport: wk.sport,
            name: wk.name,
            durationS: wk.durationS,
            distanceM: wk.distanceM,
            load: wk.load,
            avgHr: wk.avgHr,
            avgPower: wk.avgPower,
            elevationM: wk.elevationM,
          },
        });
      activityCount++;
    }

    ctl += (dayLoad - ctl) / 42;
    atl += (dayLoad - atl) / 7;

    // Physiology follows the story: overload suppresses HRV, raises resting
    // HR, and erodes sleep; the recovery week rebounds slightly above baseline.
    const stress01 =
      phase === "hard_block"
        ? 0.75 + 0.25 * Math.min(1, (i - Math.floor(days * 0.4)) / 10)
        : phase === "recovery"
          ? 0.15
          : phase === "build"
            ? 0.35
            : 0.3;

    const hrvBase =
      65 * (1 - 0.18 * stress01) * (phase === "recovery" ? 1.06 : 1);
    const hrv = round1(hrvBase * Math.exp((rand() - 0.5) * 0.16));
    const rhr = round1(47 + 6 * stress01 + (rand() - 0.5) * 2.4);
    const sleepSecs = Math.round(
      (7.6 - 0.7 * stress01 + (rand() - 0.5) * 1.1) * 3600
    );
    const sleepScore = round1(
      clamp(86 - 14 * stress01 + (rand() - 0.5) * 12, 40, 98)
    );
    weight += (rand() - 0.5) * 0.25;

    const energy = Math.round(
      clamp(8.2 - 4.5 * stress01 + (rand() - 0.5) * 1.6, 1, 10)
    );
    const soreness = Math.round(
      clamp(
        2 + 5.5 * stress01 + (dayLoad > 100 ? 1.5 : 0) + (rand() - 0.5) * 1.6,
        1,
        10
      )
    );
    const subjStress = Math.round(
      clamp(2.5 + 3.5 * stress01 + (rand() - 0.5) * 1.8, 1, 10)
    );

    const withNote = rand() < 0.18;
    const withTags = rand() < 0.22;
    const noteOptions = NOTES[phase];
    const tagOptions = TAGS[phase];

    const wellness = {
      hrvMs: hrv,
      restingHr: rhr,
      sleepSecs,
      sleepScore,
      ctl: round1(ctl),
      atl: round1(atl),
      weightKg: round1(weight),
      energy1_10: energy,
      soreness1_10: soreness,
      stress1_10: subjStress,
      mood: withNote ? (energy >= 6 ? "good" : "tired") : null,
      tags: withTags
        ? tagOptions[Math.floor(rand() * tagOptions.length)]
        : null,
      notes: withNote
        ? noteOptions[Math.floor(rand() * noteOptions.length)]
        : null,
      source: "manual" as const,
      updatedAt: new Date(),
    };

    await db
      .insert(schema.wellnessDaily)
      .values({ userId, date, ...wellness })
      .onConflictDoUpdate({
        target: [schema.wellnessDaily.userId, schema.wellnessDaily.date],
        set: wellness,
      });
  }

  const computed = await computeDailyMetrics(userId, startDate);

  // Point the coach at a local Ollama endpoint (no key required) so the chat
  // UI renders instead of the "configure a key" empty state.
  await db
    .insert(schema.llmSettings)
    .values({
      userId,
      providerType: "openai_compatible",
      baseUrl: "http://localhost:11434/v1",
      model: "llama3.1",
    })
    .onConflictDoNothing();

  await seedDemoChat(userId);

  console.log(
    `Seeded ${days} wellness days + ${activityCount} activities; computed ${computed} daily metrics.`
  );
  console.log(`Demo login: ${email} / ${password}`);
}

/**
 * One canned coach thread so the coach page isn't empty in demos. The
 * assistant text interpolates the metrics actually computed above, so the
 * conversation never contradicts the dashboard.
 */
async function seedDemoChat(userId: string) {
  const existing = await db.query.chatThreads.findFirst({
    where: eq(schema.chatThreads.userId, userId),
  });
  if (existing) return;

  const today = await db.query.dailyMetrics.findFirst({
    where: eq(schema.dailyMetrics.userId, userId),
    orderBy: (t, { desc }) => [desc(t.date)],
  });
  const wellness = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: (t, { desc }) => [desc(t.date)],
  });
  if (!today?.readiness || !wellness) return;

  const readiness = Math.round(today.readiness);
  const band = today.band ?? "amber";
  const hrv = wellness.hrvMs ?? 0;
  const tsb = today.tsb != null ? Math.round(today.tsb * 10) / 10 : 0;
  const sleepH = wellness.sleepSecs
    ? Math.round((wellness.sleepSecs / 3600) * 10) / 10
    : 0;

  const [thread] = await db
    .insert(schema.chatThreads)
    .values({ userId, title: "Should I go hard today?" })
    .returning();

  const messages: { role: "user" | "assistant"; content: string }[] = [
    {
      role: "user",
      content:
        "I have threshold intervals planned. Should I go through with them?",
    },
    {
      role: "assistant",
      content:
        `Your readiness is ${readiness} (${band}) this morning: HRV ${hrv} ms, ` +
        `about ${sleepH} h of sleep, and your form (TSB, freshness) sits at ${tsb}. ` +
        (band === "green"
          ? "You're absorbing the load well — go ahead with the session as planned, and keep the last interval honest rather than heroic."
          : band === "amber"
            ? "That's workable but not a green light. I'd keep the intervals, trim the session: drop one rep and hold the low end of your threshold range. If the first two reps feel harder than they should, convert the rest to endurance."
            : "I wouldn't. Red means recover: spin easy for 40–50 minutes or take the day off, and let's look again tomorrow."),
    },
    {
      role: "user",
      content: "Fair. What should this week look like overall?",
    },
    {
      role: "assistant",
      content:
        `With TSB at ${tsb} you're carrying fatigue from the recent block, so the priority is consolidating fitness, not adding stress. ` +
        "Keep two quality sessions (today's intervals and the weekend long ride), everything else stays truly easy. " +
        "If HRV keeps trending up through the week, we can raise the long-ride load a notch on Saturday.",
    },
  ];

  for (const m of messages) {
    await db.insert(schema.chatMessages).values({
      threadId: thread.id,
      role: m.role,
      content: m.content,
    });
  }
  console.log("Seeded demo coach thread.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

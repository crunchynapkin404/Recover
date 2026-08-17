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
import { fileURLToPath } from "node:url";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { computeDailyMetrics } from "../src/lib/metrics";
import type { ActivityLap } from "../src/lib/activity-streams";
// The app's own AES-256-GCM helper, used so seeded connector rows have an
// honest SHAPE. The plaintext inside them is deliberately worthless — see
// seedSettingsStates, and docs/ENVIRONMENTS.md's rule that the dev box never
// holds a real connector credential.
import { encrypt } from "../src/lib/crypto";

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
  await seedDemoInbox(userId);
  await seedSettingsStates(userId);
  await seedActivityStreams(userId, rand);

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
  // Scoped to kind:"chat" specifically (I1, whole-branch review 2026-08-14)
  // — this function only ever seeds one, so an unscoped ANY-thread check
  // made its own remedy a one-way door: seedDemoInbox (called right after,
  // in main()) creates five kind!=="chat" rows, so once those exist a bare
  // userId match here sees them and bails forever, even after the operator
  // deletes the actual chat thread and re-runs this script exactly as
  // scripts/verify-surfaces.ts's own failure message tells them to.
  const existing = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.userId, userId),
      eq(schema.chatThreads.kind, "chat")
    ),
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

/**
 * Five inbox items, one per InboxKind the History panel styles. Without these
 * the "From your coach" section renders its empty state and all five
 * KIND_STYLE tiles are unreachable — including in the capture script, which
 * is why the tiles' colours went unaudited until slice 4.
 *
 * `warning` is not a thread kind: it is a `morning` thread whose assistant
 * message carries toolCalls.warning (see coach-inbox.ts:114-117).
 */
export async function seedDemoInbox(userId: string) {
  const existing = await db.query.chatThreads.findFirst({
    where: and(
      eq(schema.chatThreads.userId, userId),
      inArray(schema.chatThreads.kind, [
        "morning",
        "weekly",
        "debrief",
        "monthly",
      ])
    ),
  });
  if (existing) return;

  const day = 86_400_000;
  const now = Date.now();

  const specs: {
    kind: "morning" | "weekly" | "debrief" | "monthly";
    title: string | null;
    content: string;
    ageMs: number;
    warning?: string;
    unread?: boolean;
  }[] = [
    {
      kind: "morning",
      title: null,
      content:
        "**Readiness 71 (amber).** HRV 48 ms is a touch under your 30-day " +
        "median, sleep was 7.1 h. Keep today's endurance ride, hold the low " +
        "end of zone 2, and we'll reassess before Thursday's intervals.",
      ageMs: 2 * 3600_000,
      unread: true,
    },
    {
      kind: "debrief",
      title: "Ride debrief — Tempo along the Vecht",
      content:
        "92 minutes at 198 W normalised, 84 TSS. Your last 20 minutes held " +
        "power with heart rate drifting 4 bpm — that is a clean aerobic " +
        "signature, not a fade.",
      ageMs: 1 * day,
    },
    {
      kind: "weekly",
      title: null,
      content:
        "Seven hours across five sessions, 412 TSS — 8% over the planned " +
        "week and your third straight build. Next week steps down before it " +
        "steps up again.",
      ageMs: 3 * day,
    },
    {
      kind: "morning",
      title: null,
      content:
        "HRV has sat below your baseline for four consecutive mornings while " +
        "load kept climbing. Treat today as easy or off; this is the pattern " +
        "that precedes a stall.",
      ageMs: 5 * day,
      warning: "hrv_suppressed",
    },
    {
      kind: "monthly",
      title: null,
      content:
        "July: 28 hours, 1,640 TSS, CTL from 52 to 61. Threshold power up " +
        "6 W. The consistency is doing more work than any single session.",
      ageMs: 12 * day,
    },
  ];

  for (const spec of specs) {
    const createdAt = new Date(now - spec.ageMs);
    const [thread] = await db
      .insert(schema.chatThreads)
      .values({
        userId,
        kind: spec.kind,
        title: spec.title,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    await db.insert(schema.chatMessages).values({
      threadId: thread.id,
      role: "assistant",
      content: spec.content,
      createdAt,
      // readAt null = unread. Only the newest item is left unread so the
      // badge renders "· 1" rather than a number that changes per seed run.
      readAt: spec.unread ? null : createdAt,
      ...(spec.warning ? { toolCalls: { warning: spec.warning } } : {}),
    });
  }
}

// Guard main() behind a direct-execution check so importing this module for
// its exports (e.g. seedDemoInbox in tests) never runs the whole seed flow
// or calls process.exit — see backfill-day-load.ts for the same pattern.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

/**
 * The states the Settings surface needs to render as anything but empty.
 *
 * v0.99 slice 5 opened the five <Collapsible> sections on /settings that no
 * capture had ever opened, and found the six connector cards could still only
 * render "Not connected" — `connections` was empty on every seeded database,
 * as were webhook_subscriptions, push_subscriptions and llm_usage. A surface
 * audit against cards that are all in their empty state measures the empty
 * state, which is the same trap slice 4 hit when the coach inbox's five kinds
 * were unreachable because seed-demo created only a `kind='chat'` thread.
 *
 * TOKENS ARE DELIBERATELY WORTHLESS. The cards key off a row's `status`, not
 * off decrypting anything (see strava-card.tsx), so the plaintext never needs
 * to be real — and `docs/ENVIRONMENTS.md` makes it a standing rule that the
 * dev box holds no real connector credential. They go through the app's own
 * encrypt() so the row SHAPE is honest: a card that ever did try to decrypt
 * one would get a valid decryption of an obviously fake string, rather than a
 * crash that only shows up on a real instance.
 */
async function seedSettingsStates(userId: string): Promise<void> {
  // Every provider with a card on /settings. google_calendar is a valid
  // enum member but has no card, so seeding it would add an invisible row.
  const providers = [
    { provider: "intervals_icu" as const, name: "Demo Athlete" },
    { provider: "strava" as const, name: "Demo Athlete" },
    { provider: "whoop" as const, name: "Demo Athlete" },
    { provider: "oura" as const, name: "Demo Athlete" },
    { provider: "withings" as const, name: "Demo Athlete" },
    { provider: "apple_health" as const, name: null },
  ];

  for (const [i, p] of providers.entries()) {
    const existing = await db.query.connections.findFirst({
      where: and(
        eq(schema.connections.userId, userId),
        eq(schema.connections.provider, p.provider)
      ),
    });
    if (existing) continue;
    await db.insert(schema.connections).values({
      userId,
      provider: p.provider,
      encryptedAccessToken: encrypt(`seed-not-a-real-token-${p.provider}`),
      encryptedRefreshToken: encrypt(`seed-not-a-real-refresh-${p.provider}`),
      externalAthleteId: `seed-${p.provider}-${i}`,
      externalAthleteName: p.name,
      status: "active",
      // Staggered so the cards do not all read the same "synced Xm ago",
      // which would hide a formatting bug that only shows at one magnitude.
      lastSyncAt: new Date(Date.now() - (i + 1) * 37 * 60 * 1000),
    });
  }

  // Two rows so the card renders both an enabled and a disabled subscription
  // — the disabled treatment is a distinct visual state and had never been
  // captured.
  const webhookRows = [
    {
      url: "https://example.invalid/hooks/readiness",
      events: ["readiness_computed", "band_changed"],
      active: true,
    },
    {
      url: "https://example.invalid/hooks/backups",
      events: ["backup_completed"],
      active: false,
    },
  ];
  for (const w of webhookRows) {
    const existing = await db.query.webhookSubscriptions.findFirst({
      where: and(
        eq(schema.webhookSubscriptions.userId, userId),
        eq(schema.webhookSubscriptions.url, w.url)
      ),
    });
    if (existing) continue;
    await db.insert(schema.webhookSubscriptions).values({
      userId,
      url: w.url,
      encryptedSecret: encrypt("seed-not-a-real-webhook-secret"),
      events: w.events,
      active: w.active,
    });
  }

  // endpoint is UNIQUE, so onConflictDoNothing is the idempotency guard here
  // rather than a findFirst.
  await db
    .insert(schema.pushSubscriptions)
    .values({
      userId,
      endpoint: `https://example.invalid/push/seed-${userId}`,
      p256dh: "seed-not-a-real-p256dh-key",
      auth: "seed-not-a-real-auth-secret",
      userAgent: "Seed/1.0 (demo data)",
    })
    .onConflictDoNothing();

  // A handful of rows across two days and both slots, so llm-usage-card
  // renders a real total and a per-model breakdown instead of a zero.
  const usageRows = [
    { model: "llama3.1", slot: "quick" as const, purpose: "chat" as const },
    { model: "llama3.1", slot: "quick" as const, purpose: "morning" as const },
    { model: "llama3.1", slot: "deep" as const, purpose: "weekly" as const },
    {
      model: "llama3.1",
      slot: "deep" as const,
      purpose: "ride_review" as const,
    },
  ];
  const existingUsage = await db.query.llmUsage.findFirst({
    where: eq(schema.llmUsage.userId, userId),
  });
  if (!existingUsage) {
    for (const [i, u] of usageRows.entries()) {
      await db.insert(schema.llmUsage).values({
        userId,
        model: u.model,
        slot: u.slot,
        purpose: u.purpose,
        inputTokens: 1200 + i * 430,
        outputTokens: 300 + i * 110,
        createdAt: new Date(Date.now() - i * 11 * 60 * 60 * 1000),
      });
    }
  }

  console.log(
    "Seeded Settings states: connections, webhooks, push, llm usage."
  );
}

/**
 * The states /activity/[id] needs to render as anything but StreamDataEmpty.
 *
 * activity_streams had 0 rows against 114 seeded activities.
 * getOrFetchActivityDetail (src/lib/activity-streams.ts) reads cached rows
 * first and, finding none, falls through to an intervals.icu fetch dev has
 * no credentials for, returning reason: "unavailable" — so charts and the
 * laps table were unreachable on every seeded database. Same trap as
 * seedDemoInbox and seedSettingsStates, one surface later.
 *
 * The capture resolver opens the first activity link on
 * `/train?tab=history`, which lists newest-first, so it's the most recent
 * activity — not an arbitrary one — that needs data.
 *
 * Shapes are written against what fromRows (activity-streams.ts) actually
 * parses, not the schema.ts column comment: a row's `type` of "intervals"
 * (LAPS_TYPE there) is the laps array; every other `type` is stored
 * directly as `streams[row.type]`, a plain (number | null)[]. The reading
 * pages key off `heartrate`, `watts`, `altitude` and — confirmed against
 * both connectors/intervals.ts's STREAM_TYPES and the velocity read on the
 * detail/Today pages — `velocity_smooth`, not the "velocity" the schema.ts
 * inline comment suggests. `time` is seeded too since it's one of
 * intervals.icu's five fetched stream types, even though no chart reads it
 * directly.
 *
 * Series are ~300 points of *varying* values on purpose: StreamChart
 * downsamples to 300 and bails (`nums.length < 2` → null) or clamps a zero
 * range to 1, so a constant series photographs as a flat line and proves
 * nothing about the component the capture exists to audit.
 */
async function seedActivityStreams(
  userId: string,
  rand: () => number
): Promise<void> {
  const activity = await db.query.activities.findFirst({
    where: eq(schema.activities.userId, userId),
    orderBy: (t, { desc }) => [desc(t.startDate)],
  });
  if (!activity) return;

  const POINTS = 300;
  const dtS =
    activity.durationS && activity.durationS > 0
      ? activity.durationS / POINTS
      : 3;
  const hrBase = activity.avgHr ?? 138;
  const wattsBase = activity.avgPower ?? 180;

  // time: steadily increasing seconds across the ride's real duration.
  const time: number[] = [];
  for (let i = 0; i < POINTS; i++) time.push(Math.round(i * dtS));

  // heartrate: slow aerobic-drift upward plus per-sample noise.
  const heartrate: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    const drift = (i / POINTS) * 14;
    const noise = (rand() - 0.5) * 10;
    heartrate.push(Math.round(clamp(hrBase - 7 + drift + noise, 80, 195)));
  }

  // watts: spiky — periodic surges (intervals) over a noisy base, never flat.
  const watts: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    const surge = Math.sin(i / 9) > 0.6 ? 90 + rand() * 60 : 0;
    const noise = (rand() - 0.5) * 40;
    watts.push(Math.max(0, Math.round(wattsBase - 20 + surge + noise)));
  }

  // velocity_smooth: m/s, gentle rolling variation around a plausible pace.
  const velocitySmooth: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    const wave = Math.sin(i / 24) * 1.6;
    const noise = (rand() - 0.5) * 0.8;
    velocitySmooth.push(round1(Math.max(0, 7.2 + wave + noise)));
  }

  // altitude: smooth rolling terrain profile, not sample-to-sample noise.
  const altitude: number[] = [];
  let alt = 120 + rand() * 40;
  for (let i = 0; i < POINTS; i++) {
    alt += Math.sin(i / 40) * 1.8 + (rand() - 0.5) * 0.6;
    altitude.push(round1(Math.max(0, alt)));
  }

  const seriesRows: { type: string; data: number[] }[] = [
    { type: "time", data: time },
    { type: "heartrate", data: heartrate },
    { type: "watts", data: watts },
    { type: "velocity_smooth", data: velocitySmooth },
    { type: "altitude", data: altitude },
  ];

  for (const row of seriesRows) {
    const existing = await db.query.activityStreams.findFirst({
      where: and(
        eq(schema.activityStreams.activityId, activity.id),
        eq(schema.activityStreams.type, row.type)
      ),
    });
    if (existing) continue;
    await db.insert(schema.activityStreams).values({
      activityId: activity.id,
      type: row.type,
      data: row.data,
    });
  }

  // Laps: warm-up/interval/recovery/interval/cool-down, so LapsTable's
  // recovery-dimmed treatment (label matches /recover|rest|cool|warm/i) and
  // its normal treatment both get exercised.
  const LAPS_TYPE = "intervals"; // matches LAPS_TYPE in activity-streams.ts
  const lapPlan: { label: string; work: boolean }[] = [
    { label: "Warm-up", work: false },
    { label: "Interval 1", work: true },
    { label: "Recovery", work: false },
    { label: "Interval 2", work: true },
    { label: "Cool-down", work: false },
  ];
  const laps: ActivityLap[] = lapPlan.map((lap, i) => ({
    index: i + 1,
    label: lap.label,
    durationS: Math.round(
      (lap.work ? 480 : 300) + rand() * (lap.work ? 120 : 90)
    ),
    distanceM: Math.round(
      (lap.work ? 2400 : 1200) + rand() * (lap.work ? 600 : 400)
    ),
    avgHr: Math.round(hrBase + (lap.work ? 18 : -22) + rand() * 8),
    avgPower: Math.round(wattsBase + (lap.work ? 55 : -60) + rand() * 20),
  }));

  const existingLaps = await db.query.activityStreams.findFirst({
    where: and(
      eq(schema.activityStreams.activityId, activity.id),
      eq(schema.activityStreams.type, LAPS_TYPE)
    ),
  });
  if (!existingLaps) {
    await db.insert(schema.activityStreams).values({
      activityId: activity.id,
      type: LAPS_TYPE,
      data: laps,
    });
  }

  // Every seeded activity's debriefState is NULL; this is a plain
  // idempotent overwrite (not a guarded insert) so SheetHost's no-id
  // `?sheet=debrief` path always has a pending row to find.
  await db
    .update(schema.activities)
    .set({ debriefState: "pending" })
    .where(eq(schema.activities.id, activity.id));

  console.log(
    `Seeded activity streams + ${laps.length} laps for activity ${activity.id} (debriefState=pending).`
  );
}

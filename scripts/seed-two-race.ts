/**
 * Seed a two-A-race season for the demo owner, so `verify-surfaces.ts` can
 * capture the multi-A-race preview. Built for screenshots — never production.
 *
 * Guard: refuses to run unless SEED_DEMO=1.
 *
 * **Why this exists as its own script.** `seed-demo.ts` seeds activities,
 * wellness and chat; it seeds no races and no training plans at all. Without
 * this, `/train` renders the single-race path under a name promising the
 * two-race one — the exact false pass `coach-history` shipped with for the
 * whole life of that surface (docs/2026-08-19-phase-3-handoff.md).
 *
 * **The draft is built through the real `previewTrainingPlan`**, not by
 * hand-inserting a `training_plans` row. A hand-built fixture would prove the
 * capture can render *a* row; only the real producer proves it renders what
 * the engine actually emits.
 *
 * Idempotent: races are keyed on (user, name) and the draft is replaced.
 *
 * Usage:
 *   SEED_DEMO=1 DEMO_EMAIL=demo@recover.local npx tsx scripts/seed-two-race.ts
 */
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import { previewTrainingPlan } from "../src/lib/training-plan";

const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Both races are A-priority and `upcoming`, which `previewTrainingPlan`
 * requires of both targets. The gap is deliberately WIDE enough to clear the
 * `no_bridge_room` floor (marathon -> marathon needs 14 + 21 = 35 days), so
 * the captured plan shows a real rebuild arc rather than the degenerate
 * no-room case. A separate capture of the warned case would need its own
 * surface; this one is the shape the feature exists to produce.
 */
const FIRST_GAP_DAYS = 84; // ~12 weeks out
const SECOND_GAP_DAYS = 84 + 63; // 9 weeks after the first: recovery + rebuild + taper

async function upsertRace(
  userId: string,
  name: string,
  date: string,
  raceType: string
): Promise<string> {
  const existing = await db.query.races.findFirst({
    where: and(eq(schema.races.userId, userId), eq(schema.races.name, name)),
  });
  if (existing) {
    await db
      .update(schema.races)
      .set({ date, raceType, priority: "A", status: "upcoming", sport: "Run" })
      .where(eq(schema.races.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(schema.races)
    .values({
      userId,
      name,
      raceType,
      sport: "Run",
      date,
      priority: "A",
      status: "upcoming",
      eventDays: 1,
      distanceKm: 42.2,
      elevationM: 250,
    })
    .returning();
  return row.id;
}

async function main() {
  if (process.env.SEED_DEMO !== "1") {
    console.error(
      "Refusing to run: this seeds fake demo data. Set SEED_DEMO=1 to confirm."
    );
    process.exit(1);
  }

  const email = process.env.DEMO_EMAIL ?? "demo@recover.local";
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (!user) {
    console.error(
      `No user ${email}. Run scripts/seed-demo.ts first — this script seeds the ` +
        `season onto an existing demo owner rather than creating one, so the ` +
        `account verify-surfaces signs in as is the account that has the races.`
    );
    process.exit(1);
  }

  const now = Date.now();
  const firstDate = ymd(new Date(now + FIRST_GAP_DAYS * DAY_MS));
  const secondDate = ymd(new Date(now + SECOND_GAP_DAYS * DAY_MS));

  const firstId = await upsertRace(
    user.id,
    "Spring Marathon (demo)",
    firstDate,
    "marathon"
  );
  const secondId = await upsertRace(
    user.id,
    "Autumn Marathon (demo)",
    secondDate,
    "marathon"
  );
  console.log(`Races: ${firstDate} (first) -> ${secondDate} (final)`);

  // The real producer. previewTrainingPlan deletes any prior draft itself, so
  // reruns replace rather than accumulate.
  const result = await previewTrainingPlan({
    userId: user.id,
    raceType: "marathon",
    raceDate: secondDate,
    raceIds: [firstId, secondId],
    title: "Two-race season (demo)",
    daysPerWeek: 5,
    hoursPerWeek: 8,
  });

  if (!result.ok) {
    console.error(`previewTrainingPlan refused: ${result.reason}`);
    process.exit(1);
  }

  const segments = new Set(result.preview.phases.map((p) => p.segment));
  const recoveryRows = result.preview.phases.filter(
    (p) => p.phase === "recovery"
  );
  console.log(
    `Draft ${result.preview.planId}: ${result.preview.weeksTotal} weeks, ` +
      `segments {${[...segments].join(", ")}}, ` +
      `${result.preview.phases.length} phase rows, ` +
      `${recoveryRows.length} recovery row(s)`
  );
  if (!segments.has(2)) {
    console.error(
      "Seeded draft has no segment 2 — the capture would photograph the " +
        "single-race path. Widen SECOND_GAP_DAYS."
    );
    process.exit(1);
  }
  if (result.preview.warnings.includes("no_bridge_room")) {
    console.warn(
      "Draft carries no_bridge_room: the races are too close to rebuild " +
        "between. That is a legitimate state, but not the one this seed wants."
    );
  }
  console.log("Two-race season seeded.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

/**
 * Seed a CONFIRMED single-race plan for the demo owner, so `verify-surfaces.ts`
 * can capture the race card's pacing line. Built for screenshots — never
 * production.
 *
 * Guard: refuses to run unless SEED_DEMO=1.
 *
 * **Why this exists as its own script.** `src/app/train/page.tsx` returns
 * `<PlanPreviewCard/>` (or `<PlanEmpty/>`) whenever the athlete has no
 * CONFIRMED plan — draft or none, same branch — so the race chip, the week
 * strip and the pacing line beneath it only render once a plan has been
 * confirmed. `seed-demo.ts` seeds no races or plans at all, and
 * `seed-two-race.ts` deliberately stops at a draft (it exists to prove the
 * two-arc PREVIEW renders, and `train-plan-preview` needs that draft to
 * survive). Neither one ever reaches the confirmed-plan branch, so nothing
 * has ever exercised it in `surfaces.yml` or `soak.yml` — see
 * docs/2026-08-20-pacing-capture-gap.md.
 *
 * **MUST run before `seed-two-race.ts`, not after.** `previewTrainingPlan`
 * enforces "one draft per athlete" by deleting every existing draft for the
 * user before inserting its own (`src/lib/training-plan.ts`). This script's
 * own draft is confirmed (and so no longer a draft) by the time it exits, so
 * a `seed-two-race.ts` run afterward deletes nothing of this script's — but
 * the reverse order deletes `seed-two-race.ts`'s two-arc draft the moment
 * this script previews its own single-race one. Order the seeding steps
 * accordingly (`surfaces.yml`, `soak.yml`, CONTRIBUTING.md).
 *
 * **The plan is built and confirmed through the real `previewTrainingPlan`
 * and `confirmTrainingPlan`**, not by hand-inserting rows — the same reason
 * `seed-two-race.ts` gives: only the real producer proves the capture
 * renders what the engine actually emits, not a fixture shaped to match it.
 *
 * Idempotent: the race is keyed on (user, name) and the plan is replaced.
 *
 * Usage:
 *   SEED_DEMO=1 DEMO_EMAIL=demo@recover.local npx tsx scripts/seed-confirmed-race.ts
 */
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";
import {
  previewTrainingPlan,
  confirmTrainingPlan,
} from "../src/lib/training-plan";
import { raceCard } from "../src/lib/race/outlook";

const DAY_MS = 24 * 60 * 60 * 1000;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Four and a bit weeks out: close enough that the plan is a real build (not
 * a multi-month horizon dominated by base phase), far enough that it is not
 * a "too close to plan" edge case. Confirmed empirically (2026-08-24): this
 * gap previews and confirms cleanly and yields `pacing.available: true` off
 * the seeded athlete's run history alone, at "low" confidence — the exact
 * derived-anchor path `docs/2026-08-20-pacing-capture-gap.md` describes.
 */
const RACE_GAP_DAYS = 30;

async function upsertRace(
  userId: string,
  name: string,
  date: string
): Promise<string> {
  const existing = await db.query.races.findFirst({
    where: and(eq(schema.races.userId, userId), eq(schema.races.name, name)),
  });
  if (existing) {
    await db
      .update(schema.races)
      .set({ date, priority: "A", status: "upcoming", sport: "Run" })
      .where(eq(schema.races.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(schema.races)
    .values({
      userId,
      name,
      raceType: "marathon",
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
      `No user ${email}. Run scripts/seed-demo.ts first — this script seeds ` +
        "a confirmed plan onto an existing demo owner rather than creating " +
        "one, so the account verify-surfaces signs in as is the account " +
        "with the plan."
    );
    process.exit(1);
  }

  const raceDate = ymd(new Date(Date.now() + RACE_GAP_DAYS * DAY_MS));
  const raceId = await upsertRace(user.id, "Confirmed Race (demo)", raceDate);
  console.log(`Race: ${raceDate}`);

  const result = await previewTrainingPlan({
    userId: user.id,
    raceType: "marathon",
    raceDate,
    raceIds: [raceId],
    title: "Confirmed race plan (demo)",
    daysPerWeek: 5,
    hoursPerWeek: 8,
  });
  if (!result.ok) {
    console.error(`previewTrainingPlan refused: ${result.reason}`);
    process.exit(1);
  }

  const confirmed = await confirmTrainingPlan(user.id, result.preview.planId);
  if (!confirmed.ok) {
    console.error(`confirmTrainingPlan refused: ${confirmed.reason}`);
    process.exit(1);
  }
  console.log(`Confirmed plan ${confirmed.planId}.`);

  // Self-check, same shape as seed-two-race.ts's segment-2 assertion: prove
  // the state this seed exists to produce actually came out, rather than
  // trusting that "no error" means "pacing renders". A refusal here means
  // this seed is not doing its job, and the new surface would otherwise file
  // whatever DID render under a name promising the pacing line.
  const card = await raceCard(user.id, new Date());
  if (!card.race) {
    console.error(
      "Seeded plan confirmed, but raceCard() sees no race at all — " +
        "refusing to report success."
    );
    process.exit(1);
  }
  if (!card.pacing?.available) {
    console.error(
      "Seeded plan confirmed, but pacing is not available " +
        `(${card.pacing ? card.pacing.kind : "null"}). The capture would ` +
        "file the Unavailable branch under a name promising a real target. " +
        "Check the seeded athlete's run history in seed-demo.ts — pacing " +
        "derives a threshold pace from it when none is set explicitly."
    );
    process.exit(1);
  }
  console.log(
    `Confirmed race pacing seeded: ${card.pacing.confidence} confidence.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

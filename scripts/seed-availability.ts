/**
 * Seed a week of TIMED availability for the demo owner, so
 * `verify-surfaces.ts` can capture the availability drag-timeline. Built for
 * screenshots — never production.
 *
 * Guard: refuses to run unless SEED_DEMO=1.
 *
 * **Why this exists as its own script.** Nothing in `scripts/` seeded
 * availability at all. `train-availability` was added to `SURFACES` in slice
 * 3, and on a fresh database it photographs seven empty tracks — a green
 * capture of a surface with nothing on it. Worse on a dev database that has
 * `availability_defaults` rows: those hold LEGACY blocks (`start: null`,
 * duration only), which the timeline correctly declines to place on a track,
 * so the surface renders as seven empty bars with chips underneath and looks
 * broken while being right. Either way the capture proved nothing about the
 * pills, the energy fills, the notch counts or the 44px floor.
 *
 * The week below is deliberately shaped to exercise the cases that have
 * actually broken:
 *   - a block under the 44px floor (Mon, 1h) and one comfortably over it
 *     (Sat, 3h30) — so the floor's distortion is visible in one photograph
 *   - all three energies, so the fill densities and the 0/1/2 notch counts
 *     are all on screen
 *   - a day with TWO blocks (Fri) — the layout's neighbour-clamping case
 *   - a rest day (Wed), so an empty track is captured too
 *
 * Writes `availability_overrides`, not defaults: overrides are what the
 * timeline edits, and they carry the `Pinned` badge the sheet renders.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  validateBlocks,
  type AvailabilityBlock,
} from "@/lib/availability/types";

if (process.env.SEED_DEMO !== "1") {
  console.error(
    "Refusing to run: this seeds fake demo data. Set SEED_DEMO=1 to confirm."
  );
  process.exit(1);
}

const WEEK: {
  start: string;
  end: string;
  energy: AvailabilityBlock["energy"];
}[][] = [
  [{ start: "06:30", end: "07:30", energy: "easy" }],
  [{ start: "18:00", end: "19:30", energy: "full" }],
  [],
  [{ start: "17:30", end: "19:45", energy: "full" }],
  [
    { start: "07:00", end: "08:00", energy: "normal" },
    { start: "19:00", end: "20:00", energy: "easy" },
  ],
  [{ start: "09:00", end: "12:30", energy: "normal" }],
  [{ start: "10:00", end: "11:00", energy: "easy" }],
];

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday-first, matching the app's week everywhere (see src/lib/weekdays.ts). */
function mondayOf(d: Date): Date {
  const c = new Date(d);
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  c.setHours(0, 0, 0, 0);
  return c;
}

function toMins(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

async function main() {
  const email = process.env.OWNER_EMAIL ?? "demo@recover.local";
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });
  if (!user)
    throw new Error(`no user ${email} — run scripts/seed-demo.ts first`);

  const monday = mondayOf(new Date());
  const dates = WEEK.map((_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return localYmd(d);
  });

  // Replaced, not appended: re-running must be idempotent, and a second run
  // that stacked a duplicate week would produce overlaps validateBlocks
  // rejects on the athlete's next Confirm.
  await db
    .delete(schema.availabilityOverrides)
    .where(
      and(
        eq(schema.availabilityOverrides.userId, user.id),
        inArray(schema.availabilityOverrides.date, dates)
      )
    );

  for (const [i, day] of WEEK.entries()) {
    const blocks: AvailabilityBlock[] = day.map((b) => ({
      start: b.start,
      end: b.end,
      mins: toMins(b.end) - toMins(b.start),
      energy: b.energy,
      sports: null,
    }));
    // The same gate every writer passes through. A seed that plants a value
    // the app would refuse is a fixture that tests nothing.
    const invalid = validateBlocks(blocks);
    if (invalid)
      throw new Error(`day ${dates[i]} is not a legal week: ${invalid}`);
    await db.insert(schema.availabilityOverrides).values({
      userId: user.id,
      date: dates[i],
      blocks,
    } as never);
    console.log(
      `${dates[i]}  ${blocks.map((b) => `${b.start}-${b.end} ${b.energy}`).join(" + ") || "rest"}`
    );
  }
  console.log(`Seeded a timed availability week for ${email}.`);
  process.exit(0);
}

main();

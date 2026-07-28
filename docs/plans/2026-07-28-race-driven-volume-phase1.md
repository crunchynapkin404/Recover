# Race-Driven Training Volume (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plan's weekly training hours follow the event being trained for — its distance, elevation and number of days — instead of a number typed once at plan creation that no code path ever updates.

**Architecture:** Five new pure modules compute demand, level, ceiling, target and feasibility with no I/O. One data-access function assembles their inputs. `periodize()` becomes pure over the derived target and is recomputed at every rollover, so nothing is stored as the source of truth and no value can go stale. With no event demand set, every function falls through to today's behaviour — the whole phase is inert until an athlete enters a distance.

**Tech Stack:** TypeScript, Next.js 16 (`proxy.ts`, not `middleware.ts`), Drizzle ORM + Postgres, Vitest, Tailwind v4, React 19.

## Global Constraints

- **Read `node_modules/next/dist/docs/` before writing any Next.js code.** This is not the Next.js in your training data; APIs and file conventions differ.
- **Every export from a `"use server"` file must be an async function.** A sync export compiles under `tsc` and fails only at `npm run build`.
- **The verification gate is `npm run typecheck && npm run lint && npm test && npm run build`.** `npm run build` is not optional — it is the only check that catches the above.
- **Any new Vitest file importing `@/lib/db` must gate with `describe.skipIf(!hasDb)`**, where `const hasDb = !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";`. Without it CI crashes instead of skipping.
- **Never edit `.env` or `.env.local`.** They point at the dev database (`recover-devdb`, port 5435) deliberately. Override per-process only.
- **Constants are heuristics.** `TRAINING_FRACTION` 0.25, `HEADROOM` 1.3, `LONGEST_RIDE_FRACTION` 0.8, the level bands and FTP fractions live in exported constants objects with tests pinning known cases. Never inline these numbers.
- **Prettier formats everything:** `npx prettier --write <files>` before every commit.
- **Do not write a second activity de-duplicator.** `dedupeActivities()` already exists in `src/lib/training-load.ts`.

---

### Task 1: Migration and schema for event demand

**Files:**

- Create: `drizzle/0033_race_demand.sql`
- Modify: `drizzle/meta/_journal.json` (append entry idx 33)
- Modify: `src/lib/db/schema.ts` (races table ~line 776, bodyPrefs ~line 549, new raceStages table)
- Test: `tests/race-demand-schema.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `schema.races.eventDays`, `schema.races.distanceKm`, `schema.races.elevationM`, `schema.races.demandHoursOverride`; `schema.raceStages` with `{ id, raceId, dayNumber, distanceKm, elevationM, name }`; `schema.bodyPrefs.levelOverride`.

- [ ] **Step 1: Write the migration**

Create `drizzle/0033_race_demand.sql`:

```sql
ALTER TABLE "races" ADD COLUMN IF NOT EXISTS "event_days" integer NOT NULL DEFAULT 1;
ALTER TABLE "races" ADD COLUMN IF NOT EXISTS "distance_km" real;
ALTER TABLE "races" ADD COLUMN IF NOT EXISTS "elevation_m" integer;
ALTER TABLE "races" ADD COLUMN IF NOT EXISTS "demand_hours_override" real;

CREATE TABLE IF NOT EXISTS "race_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "race_id" uuid NOT NULL REFERENCES "races"("id") ON DELETE CASCADE,
  "day_number" integer NOT NULL,
  "distance_km" real,
  "elevation_m" integer,
  "name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "race_stages_race_day_uq"
  ON "race_stages" ("race_id", "day_number");

ALTER TABLE "body_prefs" ADD COLUMN IF NOT EXISTS "level_override" text;
```

Every statement is additive and idempotent. `event_days` defaults to 1 so every existing race stays a valid single-day event. No backfill, no down migration.

- [ ] **Step 2: Register the migration in the journal**

Append to the `entries` array in `drizzle/meta/_journal.json`, after the `idx: 32` entry:

```json
{
  "idx": 33,
  "version": "7",
  "when": 1785261525532,
  "tag": "0033_race_demand",
  "breakpoints": true
}
```

`when` must be greater than entry 32's `1785175125532`. The container's `docker-entrypoint.sh` runs `node scripts/migrate.mjs` on boot, so an unregistered migration silently never runs.

- [ ] **Step 3: Add the columns and table to the Drizzle schema**

In `src/lib/db/schema.ts`, inside the `races` table definition, after `goalNote`:

```ts
    /** Days the event runs over. 1 = a normal single-day race. */
    eventDays: integer("event_days").notNull().default(1),
    /** TOTAL distance across all days. null = demand not computable. */
    distanceKm: real("distance_km"),
    /** TOTAL elevation gain across all days. */
    elevationM: integer("elevation_m"),
    /** Athlete's own weekly-hours figure; wins over the computed one. */
    demandHoursOverride: real("demand_hours_override"),
```

After the `races` table, add:

```ts
/**
 * Per-day detail for a multi-day event. Optional: without stages the demand
 * model treats every day as the average day. With them it also learns the
 * QUEEN STAGE — the hardest single day — which sets the longest-ride target.
 */
export const raceStages = pgTable(
  "race_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id, { onDelete: "cascade" }),
    dayNumber: integer("day_number").notNull(),
    distanceKm: real("distance_km"),
    elevationM: integer("elevation_m"),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("race_stages_race_day_uq").on(t.raceId, t.dayNumber)]
);
```

In `bodyPrefs`, after `birthYear`:

```ts
  /** Manual athlete-level override; null = use the computed level. */
  levelOverride: text("level_override"),
```

- [ ] **Step 4: Write the schema test**

Create `tests/race-demand-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("migration 0033", () => {
  it("adds the event demand columns to races", async () => {
    const r = await db.execute(
      sql`select column_name from information_schema.columns where table_name = 'races'`
    );
    const cols = r.rows.map((x) => x.column_name);
    expect(cols).toContain("event_days");
    expect(cols).toContain("distance_km");
    expect(cols).toContain("elevation_m");
    expect(cols).toContain("demand_hours_override");
  });

  it("defaults event_days to 1 so existing races stay valid", async () => {
    const r = await db.execute(
      sql`select column_default from information_schema.columns
          where table_name = 'races' and column_name = 'event_days'`
    );
    expect(String(r.rows[0].column_default)).toContain("1");
  });

  it("creates race_stages with a unique day per race", async () => {
    const r = await db.execute(
      sql`select indexname from pg_indexes where tablename = 'race_stages'`
    );
    expect(r.rows.map((x) => x.indexname)).toContain("race_stages_race_day_uq");
  });
});
```

- [ ] **Step 5: Run the migration against the dev database and verify**

```bash
cd /home/vscode/recover
DATABASE_URL="postgres://recover:devpass@localhost:5435/recover" DATABASE_DRIVER=pg node scripts/migrate.mjs
DATABASE_URL="postgres://recover:devpass@localhost:5435/recover" DATABASE_DRIVER=pg npx vitest run tests/race-demand-schema.test.ts
```

Expected: migration reports applied; 3 tests PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npx prettier --write src/lib/db/schema.ts tests/race-demand-schema.test.ts drizzle/meta/_journal.json
npm run typecheck
git add drizzle/0033_race_demand.sql drizzle/meta/_journal.json src/lib/db/schema.ts tests/race-demand-schema.test.ts
git commit -m "feat(db): event demand columns, race stages, level override"
```

---

### Task 2: Estimated riding time from distance and elevation

**Files:**

- Create: `src/lib/race/demand-constants.ts`
- Create: `src/lib/race/riding-time.ts`
- Test: `src/lib/race/riding-time.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `DEMAND_CONSTANTS`; `estimateRidingHours(input: RidingTimeInput): number | null` where `RidingTimeInput = { distanceKm: number; elevationM: number; ftpWatts: number; massKg: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/race/riding-time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimateRidingHours } from "./riding-time";

// The calibration athlete: FTP 310W, 79kg rider + 8kg bike = 87kg total.
const ATHLETE = { ftpWatts: 310, massKg: 87 };

describe("estimateRidingHours", () => {
  it("estimates the 8-day alpine tour at roughly 50 hours", () => {
    const h = estimateRidingHours({
      distanceKm: 900,
      elevationM: 20000,
      ...ATHLETE,
    });
    expect(h).not.toBeNull();
    expect(h!).toBeGreaterThan(38);
    expect(h!).toBeLessThan(50);
  });

  it("estimates a single alpine gran fondo at roughly 6-7 hours", () => {
    const h = estimateRidingHours({
      distanceKm: 130,
      elevationM: 4000,
      ...ATHLETE,
    });
    expect(h!).toBeGreaterThan(4.5);
    expect(h!).toBeLessThan(7);
  });

  it("takes longer for the same distance with more climbing", () => {
    const flat = estimateRidingHours({
      distanceKm: 150,
      elevationM: 500,
      ...ATHLETE,
    })!;
    const hilly = estimateRidingHours({
      distanceKm: 150,
      elevationM: 3500,
      ...ATHLETE,
    })!;
    expect(hilly).toBeGreaterThan(flat);
  });

  it("takes longer for a weaker rider", () => {
    const strong = estimateRidingHours({
      distanceKm: 150,
      elevationM: 2000,
      ftpWatts: 310,
      massKg: 87,
    })!;
    const weak = estimateRidingHours({
      distanceKm: 150,
      elevationM: 2000,
      ftpWatts: 180,
      massKg: 87,
    })!;
    expect(weak).toBeGreaterThan(strong);
  });

  it("returns null rather than guessing when inputs are unusable", () => {
    expect(
      estimateRidingHours({ distanceKm: 0, elevationM: 0, ...ATHLETE })
    ).toBeNull();
    expect(
      estimateRidingHours({
        distanceKm: 100,
        elevationM: 1000,
        ftpWatts: 0,
        massKg: 87,
      })
    ).toBeNull();
  });

  it("treats negative elevation as zero, never as a time credit", () => {
    const h = estimateRidingHours({
      distanceKm: 100,
      elevationM: -500,
      ...ATHLETE,
    })!;
    const flat = estimateRidingHours({
      distanceKm: 100,
      elevationM: 0,
      ...ATHLETE,
    })!;
    expect(h).toBeCloseTo(flat, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/race/riding-time.test.ts
```

Expected: FAIL — `Cannot find module './riding-time'`.

- [ ] **Step 3: Write the constants**

Create `src/lib/race/demand-constants.ts`:

```ts
/**
 * Coaching heuristics, not derived truth.
 *
 * Calibrated against one athlete and the published coaching consensus. They
 * live here, together and exported, so tuning is a one-line change with tests
 * that fail loudly — not a hunt through the engine. Never inline these values.
 */
export const DEMAND_CONSTANTS = {
  /** Effective frontal area (m²) for a rider on the hoods. */
  CDA: 0.32,
  /** Air density at low altitude (kg/m³). */
  AIR_DENSITY: 1.225,
  /** Wind, corners, rolling resistance, stops — flat speed is never ideal. */
  REAL_WORLD_FACTOR: 0.85,
  /** Fraction of FTP sustainable for an event of a given length. */
  FTP_FRACTION: [
    { upToHours: 3, fraction: 0.85 },
    { upToHours: 5, fraction: 0.75 },
    { upToHours: Infinity, fraction: 0.68 },
  ],
  /**
   * Average gradient of the climbing portions of an event. Used to work out
   * how much of the total distance is spent ascending, so that distance is
   * not charged twice — see riding-time.ts.
   */
  CLIMB_GRADIENT: 0.07,
  /** Fixed-point iterations resolving "power needs duration needs power". */
  POWER_ITERATIONS: 2,
  /** Starting guess before the first iteration. */
  INITIAL_FTP_FRACTION: 0.75,
  /**
   * Weekly training volume as a share of the event's daily rate extrapolated
   * to a week. Replaces the earlier VOLUME_FACTOR, which was only ever
   * 7 × this.
   */
  TRAINING_FRACTION: 0.25,
  /** Default total mass (kg) when the athlete's weight is unknown. */
  DEFAULT_MASS_KG: 83,
} as const;
```

- [ ] **Step 4: Write the implementation**

Create `src/lib/race/riding-time.ts`:

```ts
/**
 * How long an event actually takes this rider — from its distance and
 * elevation, and their power and mass.
 *
 * Physics rather than a lookup table by race type, because every input already
 * exists in the database (`body_prefs.ftp_watts`, `wellness_daily.eftp`,
 * `wellness_daily.weight_kg`) and because "gran fondo" tells you nothing about
 * whether it climbs 800m or 4000m.
 *
 * Pure — no I/O, no clock.
 */
import { DEMAND_CONSTANTS as C } from "./demand-constants";

export interface RidingTimeInput {
  /** Total distance in km (summed across all days for a stage event). */
  distanceKm: number;
  /** Total elevation gain in metres. */
  elevationM: number;
  ftpWatts: number;
  /** Rider plus bike plus kit, in kg. */
  massKg: number;
}

/** Sustainable share of FTP for an event expected to last `hours`. */
function ftpFractionFor(hours: number): number {
  for (const band of C.FTP_FRACTION) {
    if (hours <= band.upToHours) return band.fraction;
  }
  return C.FTP_FRACTION[C.FTP_FRACTION.length - 1].fraction;
}

/**
 * Steady speed on the flat at a given power, from the drag equation
 * `P = ½ ρ CdA v³`, scaled by REAL_WORLD_FACTOR for everything the drag
 * equation ignores.
 */
function flatSpeedKmh(powerW: number): number {
  const v = Math.cbrt(powerW / (0.5 * C.AIR_DENSITY * C.CDA));
  return v * 3.6 * C.REAL_WORLD_FACTOR;
}

/**
 * Estimated moving time in hours, or null when the inputs cannot support an
 * estimate. Null is deliberate: a fabricated duration would propagate into a
 * training target and a feasibility verdict.
 *
 * Sustainable power depends on how long the event lasts, and the duration
 * depends on the power — resolved by fixed-point iteration, which converges
 * within a couple of passes because the FTP bands are coarse.
 */
export function estimateRidingHours(input: RidingTimeInput): number | null {
  const { distanceKm, ftpWatts, massKg } = input;
  // Descending does not give time back in any model worth trusting.
  const elevationM = Math.max(0, input.elevationM);

  if (!(distanceKm > 0) || !(ftpWatts > 0) || !(massKg > 0)) return null;

  // Annotated: DEMAND_CONSTANTS is `as const`, so an inferred type would be
  // the literal 0.75 and the reassignment below would not compile.
  let fraction: number = C.INITIAL_FTP_FRACTION;
  let hours = 0;

  for (let i = 0; i < C.POWER_ITERATIONS + 1; i++) {
    const powerW = ftpWatts * fraction;
    const speedKmh = flatSpeedKmh(powerW);

    // Work to lift mass against gravity, delivered at this power.
    const climbHours = (massKg * 9.81 * elevationM) / (powerW * 3600);
    const flatHours = distanceKm / speedKmh;

    // Those two terms overlap. The flat term charges the WHOLE distance at
    // flat speed; the climb term then adds the time to gain the elevation —
    // but you cover ground while climbing, so the ascending kilometres are
    // paid for twice. Subtract their flat-equivalent time.
    //
    // Without this correction a 130km/4000m alpine fondo came out at 8.6h for
    // a 3.9 W/kg rider who rides it in about 6:30.
    const climbDistanceKm = elevationM / 1000 / C.CLIMB_GRADIENT;
    // Capped at the whole distance: on a hill-climb time trial the ascent
    // accounts for every kilometre, and the overlap can never exceed the ride.
    const overlapHours = Math.min(flatHours, climbDistanceKm / speedKmh);

    hours = climbHours + flatHours - overlapHours;
    fraction = ftpFractionFor(hours);
  }

  return hours;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/lib/race/riding-time.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/race/demand-constants.ts src/lib/race/riding-time.ts src/lib/race/riding-time.test.ts
npm run typecheck
git add src/lib/race/demand-constants.ts src/lib/race/riding-time.ts src/lib/race/riding-time.test.ts
git commit -m "feat(race): estimate event riding time from distance and elevation"
```

---

### Task 3: Event demand — weekly hours, daily rate, queen stage

**Files:**

- Create: `src/lib/race/demand.ts`
- Test: `src/lib/race/demand.test.ts`

**Interfaces:**

- Consumes: `estimateRidingHours` and `DEMAND_CONSTANTS` from Task 2.
- **Modifies `src/lib/race/demand-constants.ts`:** delete `TRAINING_FRACTION`
  (0.25) and add the two constants below. Task 2 shipped `TRAINING_FRACTION`
  before the research pass superseded it; nothing consumes it yet.

```ts
  /**
   * An event's total load as a multiple of a weekly training load, at one day.
   * A long sportive is 200-350 TSS against ~630 sustainable weekly TSS at
   * CTL 90 — about half a training week. Cross-checked against published
   * 8-12 h/week century plans.
   */
  EVENT_TO_WEEKLY_1DAY: 0.6,
  /**
   * How that multiple grows with event length. Fitted to exactly two anchors:
   * 0.60 at one day (above) and 2.50 at eight days (CTS: "a multi-day event is
   * likely 2-3 times your normal weekly training load").
   */
  MULTI_DAY_EXPONENT: 0.686,
```

- Produces:

```ts
export interface EventStage {
  dayNumber: number;
  distanceKm: number | null;
  elevationM: number | null;
}
export interface EventDemandInput {
  eventDays: number;
  distanceKm: number | null;
  elevationM: number | null;
  stages: EventStage[];
  overrideWeeklyHours: number | null;
  ftpWatts: number | null;
  massKg: number | null;
}
export interface EventDemand {
  totalHours: number;
  dailyRateHours: number;
  queenStageHours: number;
  queenStageKnown: boolean;
  weeklyHours: number;
  source: "computed" | "override";
}
export function eventDemand(input: EventDemandInput): EventDemand | null;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/race/demand.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eventDemand, type EventDemandInput } from "./demand";

const ATHLETE = { ftpWatts: 310, massKg: 87 };
const base: EventDemandInput = {
  eventDays: 1,
  distanceKm: null,
  elevationM: null,
  stages: [],
  overrideWeeklyHours: null,
  ...ATHLETE,
};

describe("eventDemand", () => {
  it("puts the 8-day alpine tour near 17 weekly hours", () => {
    // 42.1h of riding / 2.50 = 16.8. That is MORE than the athlete believes
    // they can manage (they estimated 9-12h) — deliberately. The ceiling in
    // weeklyTargetHours cuts it to what their chronic load supports, and the
    // gap is the finding. Do not tune the constants to close it here.
    const d = eventDemand({
      ...base,
      eventDays: 8,
      distanceKm: 900,
      elevationM: 20000,
    })!;
    expect(d.weeklyHours).toBeGreaterThan(15);
    expect(d.weeklyHours).toBeLessThan(19);
    expect(d.dailyRateHours).toBeGreaterThan(5);
    expect(d.dailyRateHours).toBeLessThan(8);
  });

  it("puts a single alpine gran fondo inside the published 8-12h band", () => {
    // 6.8h / 0.60 = 11.4 h/week. Published intermediate century and gran fondo
    // plans run 8-12 h/week, and this lands inside that band without being
    // fitted to it — only the two endpoint ratios were fitted.
    const d = eventDemand({
      ...base,
      eventDays: 1,
      distanceKm: 130,
      elevationM: 4000,
    })!;
    expect(d.weeklyHours).toBeGreaterThan(8);
    expect(d.weeklyHours).toBeLessThan(13);
  });

  it("asks MORE for a longer event of the same daily rate", () => {
    // The defect this formula replaced: averaging over days made a bigger
    // event ask for LESS. Total load must drive the number.
    const oneDay = eventDemand({
      ...base,
      eventDays: 1,
      distanceKm: 120,
      elevationM: 2500,
    })!;
    const sixDays = eventDemand({
      ...base,
      eventDays: 6,
      distanceKm: 720,
      elevationM: 15000,
    })!;
    expect(sixDays.weeklyHours).toBeGreaterThan(oneDay.weeklyHours);
  });

  it("treats a one-day event as days=1, not a special case", () => {
    // Same total riding, expressed two ways. A 1-day event must run the exact
    // same arithmetic as a multi-day one.
    const oneDay = eventDemand({
      ...base,
      eventDays: 1,
      distanceKm: 130,
      elevationM: 4000,
    })!;
    const asStage = eventDemand({
      ...base,
      eventDays: 1,
      distanceKm: null,
      elevationM: null,
      stages: [{ dayNumber: 1, distanceKm: 130, elevationM: 4000 }],
    })!;
    expect(asStage.weeklyHours).toBeCloseTo(oneDay.weeklyHours, 5);
  });

  it("derives totals by summing stages when stages are given", () => {
    const d = eventDemand({
      ...base,
      eventDays: 2,
      distanceKm: null,
      elevationM: null,
      stages: [
        { dayNumber: 1, distanceKm: 100, elevationM: 2000 },
        { dayNumber: 2, distanceKm: 120, elevationM: 3000 },
      ],
    })!;
    const fromTotals = eventDemand({
      ...base,
      eventDays: 2,
      distanceKm: 220,
      elevationM: 5000,
    })!;
    expect(d.totalHours).toBeCloseTo(fromTotals.totalHours, 1);
  });

  it("reports the queen stage as the hardest day when stages are known", () => {
    const d = eventDemand({
      ...base,
      eventDays: 2,
      distanceKm: null,
      elevationM: null,
      stages: [
        { dayNumber: 1, distanceKm: 60, elevationM: 400 },
        { dayNumber: 2, distanceKm: 160, elevationM: 4200 },
      ],
    })!;
    expect(d.queenStageKnown).toBe(true);
    expect(d.queenStageHours).toBeGreaterThan(d.dailyRateHours);
  });

  it("falls back to the average day, and says so, without stages", () => {
    const d = eventDemand({
      ...base,
      eventDays: 8,
      distanceKm: 900,
      elevationM: 20000,
    })!;
    expect(d.queenStageKnown).toBe(false);
    expect(d.queenStageHours).toBeCloseTo(d.dailyRateHours, 5);
  });

  it("lets the athlete's override win outright", () => {
    const d = eventDemand({
      ...base,
      eventDays: 8,
      distanceKm: 900,
      elevationM: 20000,
      overrideWeeklyHours: 14,
    })!;
    expect(d.weeklyHours).toBe(14);
    expect(d.source).toBe("override");
  });

  it("returns null when there is nothing to compute from", () => {
    expect(eventDemand(base)).toBeNull();
    expect(
      eventDemand({
        ...base,
        distanceKm: 130,
        elevationM: 4000,
        ftpWatts: null,
      })
    ).toBeNull();
  });

  it("defaults mass rather than refusing when weight is unknown", () => {
    const d = eventDemand({
      ...base,
      distanceKm: 130,
      elevationM: 4000,
      massKg: null,
    });
    expect(d).not.toBeNull();
  });

  it("never divides by zero on a malformed day count", () => {
    const d = eventDemand({
      ...base,
      eventDays: 0,
      distanceKm: 130,
      elevationM: 4000,
    })!;
    expect(Number.isFinite(d.weeklyHours)).toBe(true);
    expect(d.dailyRateHours).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/race/demand.test.ts
```

Expected: FAIL — `Cannot find module './demand'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/race/demand.ts`:

```ts
/**
 * What an event asks of a training week.
 *
 * A one-day race is not a separate case — it is an event with `eventDays = 1`,
 * and the same arithmetic covers a criterium and an eight-day alpine tour:
 *
 *   ratio(days) = EVENT_TO_WEEKLY_1DAY × days ^ MULTI_DAY_EXPONENT
 *   weeklyHours = totalEventHours / ratio(days)
 *
 * One quantity — the event's total load as a multiple of a weekly training
 * load — with the multiple growing as the event lengthens. Both endpoints come
 * from published sources: 0.60 at one day, 2.50 at eight.
 *
 * Nobody trains fifty hours a week for a fifty-hour tour. The rest of a stage
 * event's demand is met by plan SHAPE — back-to-back long rides — because the
 * quality such events test is recovering overnight and riding again.
 *
 * Pure — no I/O, no clock.
 */
import { DEMAND_CONSTANTS as C } from "./demand-constants";
import { estimateRidingHours } from "./riding-time";

export interface EventStage {
  dayNumber: number;
  distanceKm: number | null;
  elevationM: number | null;
}

export interface EventDemandInput {
  eventDays: number;
  /** TOTAL across all days. Ignored when `stages` are supplied. */
  distanceKm: number | null;
  elevationM: number | null;
  stages: EventStage[];
  overrideWeeklyHours: number | null;
  ftpWatts: number | null;
  massKg: number | null;
}

export interface EventDemand {
  /** Estimated riding hours for the whole event. */
  totalHours: number;
  /** Average hours per event day. */
  dailyRateHours: number;
  /** The hardest single day; equals dailyRateHours when stages are unknown. */
  queenStageHours: number;
  /** False when queenStageHours is an average rather than a known hardest day. */
  queenStageKnown: boolean;
  weeklyHours: number;
  source: "computed" | "override";
}

export function eventDemand(input: EventDemandInput): EventDemand | null {
  const ftpWatts = input.ftpWatts;
  if (ftpWatts == null || ftpWatts <= 0) return null;
  const massKg = input.massKg ?? C.DEFAULT_MASS_KG;

  // A zero or negative day count is data corruption, not a rest event.
  const days = Math.max(1, Math.floor(input.eventDays || 1));

  const usable = input.stages.filter(
    (s) => (s.distanceKm ?? 0) > 0 || (s.elevationM ?? 0) > 0
  );

  let totalHours: number | null = null;
  let queenStageHours: number | null = null;
  let queenStageKnown = false;

  if (usable.length > 0) {
    let sum = 0;
    let hardest = 0;
    for (const stage of usable) {
      const h = estimateRidingHours({
        distanceKm: stage.distanceKm ?? 0,
        elevationM: stage.elevationM ?? 0,
        ftpWatts,
        massKg,
      });
      if (h == null) continue;
      sum += h;
      hardest = Math.max(hardest, h);
    }
    if (sum > 0) {
      totalHours = sum;
      queenStageHours = hardest;
      queenStageKnown = true;
    }
  }

  if (totalHours == null) {
    totalHours = estimateRidingHours({
      distanceKm: input.distanceKm ?? 0,
      elevationM: input.elevationM ?? 0,
      ftpWatts,
      massKg,
    });
  }
  if (totalHours == null) return null;

  const dailyRateHours = totalHours / days;
  // Without stage detail the hardest day is unknown; the average is the
  // honest stand-in, and `queenStageKnown` tells consumers not to trust it
  // as a longest-ride target.
  const queen = queenStageKnown ? queenStageHours! : dailyRateHours;

  // The event's total load as a multiple of a weekly training load, with the
  // multiple growing as the event lengthens. An earlier draft averaged over
  // days and trained at a fixed share of that daily rate — which discarded
  // total event load entirely, so a 42h 8-day tour asked for LESS weekly
  // training than a 6.8h one-day fondo. Eight consecutive days are cumulative.
  const ratio = C.EVENT_TO_WEEKLY_1DAY * Math.pow(days, C.MULTI_DAY_EXPONENT);
  const computedWeekly = totalHours / ratio;
  const override = input.overrideWeeklyHours;
  const useOverride = override != null && override > 0;

  return {
    totalHours,
    dailyRateHours,
    queenStageHours: queen,
    queenStageKnown,
    weeklyHours: useOverride ? override : computedWeekly,
    source: useOverride ? "override" : "computed",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/race/demand.test.ts
```

Expected: 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/race/demand.ts src/lib/race/demand.test.ts
npm run typecheck
git add src/lib/race/demand.ts src/lib/race/demand.test.ts
git commit -m "feat(race): unified event demand model for single and multi-day events"
```

---

### Task 4: De-duplicate activities in trailing weekly averages

**Files:**

- Modify: `src/lib/weekly-targets.ts` (`trailingWeeklyAverages`, ~line 51)
- Test: `src/lib/weekly-targets.test.ts` (add cases)

**Interfaces:**

- Consumes: `dedupeActivities` from `src/lib/training-load.ts`.
- Produces: `trailingWeeklyAverages` gains `provider` on its `TrailingActivity` input.

**Why this task exists:** an athlete connected to both intervals.icu and Strava has every ride stored twice — `activities` is unique on `(provider, external_id)`, so cross-provider duplication is by design. Fed raw, this function reads ~9h/week as ~18h. Task 5 uses it to grade the athlete's level, so an undeduplicated input grades them two levels too high and prescribes a ceiling they cannot survive.

- [ ] **Step 1: Update the existing test fixtures**

`TrailingActivity` gains a required `provider`, so every existing call in
`src/lib/weekly-targets.test.ts` stops compiling. Add `provider: "strava"` to
each activity literal passed to `trailingWeeklyAverages` (four call sites, at
roughly lines 50, 60, 70 and 81). Do this first — a red typecheck from a
mechanical fixture change hides the real failing test in Step 2.

- [ ] **Step 2: Write the failing test**

Append to `src/lib/weekly-targets.test.ts`:

```ts
describe("trailingWeeklyAverages de-duplication", () => {
  const day = (n: number) => new Date(2026, 6, n, 18, 33);

  it("counts a ride synced by two providers once", () => {
    const both = [];
    // Six distinct days clears MIN_FALLBACK_ACTIVITY_DAYS.
    for (let i = 1; i <= 6; i++) {
      both.push({
        provider: "intervals_icu",
        startDate: day(i),
        durationS: 7200,
        loadValue: 100,
      });
      both.push({
        provider: "strava",
        startDate: day(i),
        durationS: 7200,
        loadValue: 100,
      });
    }
    const single = both.filter((a) => a.provider === "intervals_icu");

    const dup = trailingWeeklyAverages(both, day(7));
    const clean = trailingWeeklyAverages(single, day(7));

    expect(dup.volumeS).toBe(clean.volumeS);
    expect(dup.load).toBe(clean.load);
  });

  it("still counts two genuinely separate rides on one day", () => {
    const rides = [];
    for (let i = 1; i <= 6; i++) {
      rides.push({
        provider: "strava",
        startDate: new Date(2026, 6, i, 8, 0),
        durationS: 3600,
        loadValue: 50,
      });
      rides.push({
        provider: "strava",
        startDate: new Date(2026, 6, i, 18, 0),
        durationS: 3600,
        loadValue: 50,
      });
    }
    const r = trailingWeeklyAverages(rides, day(7));
    const half = trailingWeeklyAverages(
      rides.filter((_, i) => i % 2 === 0),
      day(7)
    );
    expect(r.volumeS!).toBeGreaterThan(half.volumeS!);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/lib/weekly-targets.test.ts
```

Expected: FAIL — the first test reports `dup.volumeS` as twice `clean.volumeS`.

- [ ] **Step 4: Write the implementation**

In `src/lib/weekly-targets.ts`, add the import:

```ts
import { dedupeActivities } from "./training-load";
```

Add `provider` to the input interface:

```ts
export interface TrailingActivity {
  /** Needed to collapse the same ride synced from two providers. */
  provider: string;
  startDate: Date;
  durationS: number | null;
  /** Engine-resolved load (activityLoad), not raw provider load. */
  loadValue: number | null;
}
```

Inside `trailingWeeklyAverages`, replace the `const window = ...` line with:

```ts
// The same ride reaches us once per connected provider (activities is
// unique on (provider, external_id), so duplication across providers is by
// design). Summing raw doubles an athlete's volume — and this function
// grades their level.
const window = dedupeActivities(
  activities
    .filter((a) => a.startDate >= floor && a.startDate <= today)
    .map((a) => ({
      provider: a.provider,
      startDate: a.startDate,
      durationS: a.durationS,
      load: a.loadValue,
      avgHr: null,
      avgPower: null,
    }))
).map((a) => ({
  startDate: a.startDate,
  durationS: a.durationS,
  loadValue: a.load,
}));
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run src/lib/weekly-targets.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/weekly-targets.ts src/lib/weekly-targets.test.ts
npm run typecheck
git add src/lib/weekly-targets.ts src/lib/weekly-targets.test.ts
git commit -m "fix(targets): trailing averages counted cross-provider duplicates twice"
```

---

### Task 5: Athlete level and the volume ceiling

> **The shipped `src/lib/athlete-level.ts` is the source of truth, not the
> reference implementation below.** Review added four things this block does
> not show: `MAINTENANCE_FLOOR`/`floorHours`, a `bandFor` guard so non-finite
> input cannot fail open to "advanced", a `peakOf` guard so one corrupt week
> cannot leak `NaN` as a ceiling, and a corrected `ceilingHours` doc comment.
> Do not re-run this task from the block below — it would regress all four.

**Files:**

- Create: `src/lib/athlete-level.ts`
- Test: `src/lib/athlete-level.test.ts`

**Interfaces:**

- Consumes: nothing (pure; callers supply the history).
- Produces:

```ts
export type AthleteLevel =
  "recreational" | "amateur" | "intermediate" | "advanced";
export const LEVEL_CONSTANTS: {
  PEAK_WINDOW_WEEKS: number;
  HEADROOM: number;
  MAINTENANCE_FLOOR: number;
  HOURS_BANDS: { max: number; level: AthleteLevel }[];
  CTL_BANDS: { max: number; level: AthleteLevel }[];
};
export interface LevelInput {
  weeklyHoursByWeek: number[];
  ctlByWeek: number[];
  override: AthleteLevel | null;
}
export interface LevelResult {
  level: AthleteLevel | null;
  peakHours: number | null;
  ceilingHours: number | null;
  /** MAINTENANCE_FLOOR x peakHours. Null in lockstep with ceilingHours. */
  floorHours: number | null;
  source: "override" | "computed" | "calibrating";
}
export function athleteLevel(input: LevelInput): LevelResult;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/athlete-level.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { athleteLevel, LEVEL_CONSTANTS } from "./athlete-level";

const flat = (value: number, weeks = 12): number[] =>
  Array.from({ length: weeks }, () => value);

describe("athleteLevel", () => {
  it("grades the calibration athlete Intermediate with an 11.6h ceiling", () => {
    // 8.9h/week peak -> Intermediate (5-9h). CTL 80 -> Advanced boundary.
    // The lower of the two wins.
    const r = athleteLevel({
      weeklyHoursByWeek: flat(8.9),
      ctlByWeek: flat(80),
      override: null,
    });
    expect(r.level).toBe("intermediate");
    expect(r.ceilingHours).toBeCloseTo(8.9 * LEVEL_CONSTANTS.HEADROOM, 3);
    expect(r.ceilingHours).toBeCloseTo(11.57, 1);
  });

  it("takes the LOWER of the hours and CTL verdicts", () => {
    // High CTL from short hard sessions must not claim 4-hour-ride capacity.
    const r = athleteLevel({
      weeklyHoursByWeek: flat(4),
      ctlByWeek: flat(95),
      override: null,
    });
    expect(r.level).toBe("amateur");
  });

  it("is unmoved by a bad fortnight — the rolling peak holds", () => {
    const history = flat(9, 10).concat([0.5, 0.5]);
    const r = athleteLevel({
      weeklyHoursByWeek: history,
      ctlByWeek: flat(80),
      override: null,
    });
    expect(r.level).toBe("advanced");
    expect(r.peakHours).toBe(9);
  });

  it("drops once the peak rolls out of the window", () => {
    // Genuine detraining: nothing high left anywhere in the window.
    const r = athleteLevel({
      weeklyHoursByWeek: flat(2, 12),
      ctlByWeek: flat(30),
      override: null,
    });
    expect(r.level).toBe("recreational");
  });

  it("only considers the most recent PEAK_WINDOW_WEEKS", () => {
    const ancient = [20, 20].concat(flat(2, 12));
    const r = athleteLevel({
      weeklyHoursByWeek: ancient,
      ctlByWeek: flat(30),
      override: null,
    });
    expect(r.peakHours).toBe(2);
  });

  it("lets an override win outright", () => {
    const r = athleteLevel({
      weeklyHoursByWeek: flat(2),
      ctlByWeek: flat(30),
      override: "advanced",
    });
    expect(r.level).toBe("advanced");
    expect(r.source).toBe("override");
  });

  it("reports calibrating rather than guessing without history", () => {
    const r = athleteLevel({
      weeklyHoursByWeek: [],
      ctlByWeek: [],
      override: null,
    });
    expect(r.level).toBeNull();
    expect(r.ceilingHours).toBeNull();
    expect(r.source).toBe("calibrating");
  });

  it("keeps the ceiling continuous, with no cliff at a band edge", () => {
    // 8.9h and 9.1h straddle the Intermediate/Advanced boundary. Their
    // ceilings must stay close — the band changes, the ceiling does not jump.
    const a = athleteLevel({
      weeklyHoursByWeek: flat(8.9),
      ctlByWeek: flat(80),
      override: null,
    });
    const b = athleteLevel({
      weeklyHoursByWeek: flat(9.1),
      ctlByWeek: flat(80),
      override: null,
    });
    expect(Math.abs(a.ceilingHours! - b.ceilingHours!)).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/athlete-level.test.ts
```

Expected: FAIL — `Cannot find module './athlete-level'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/athlete-level.ts`:

```ts
/**
 * How much training this athlete can absorb — and a human label for it.
 *
 * Four levels, borrowed from JOIN's vocabulary, but DERIVED rather than
 * declared: the athlete's own history is better evidence than a self-
 * assessment.
 *
 * ## Hysteresis without a state machine
 *
 * Driven by a rolling PEAK_WINDOW_WEEKS peak rather than the current window.
 * A bad fortnight cannot move the level, because the peak from ten weeks ago
 * still stands; genuine detraining does, once that peak rolls off. There is no
 * `previousLevel` to thread through and nothing to store — which is what the
 * derive-at-rollover architecture needs.
 *
 * The "sticky up" asymmetry is safe ONLY because the level sets a ceiling and
 * never a target. A detrained athlete is held down by the ramp guard
 * (RAMP_CLAMP_PCT, ±20% of last week's actual) regardless of whether their
 * peak has rolled off yet. If this ever starts setting the target directly,
 * the rolling peak becomes the wrong mechanism.
 *
 * ## The level does not do the volume arithmetic
 *
 * Four buckets would map an athlete at 5.1h/week and one at 8.9h/week to the
 * same ceiling, with arbitrary cliffs at the band edges. The ceiling is
 * continuous off the same peak; the level's remaining jobs are the label the
 * athlete reads and the coarse difficulty input for workout templates.
 *
 * Pure — no I/O, no clock.
 */

export type AthleteLevel =
  "recreational" | "amateur" | "intermediate" | "advanced";

const ORDER: AthleteLevel[] = [
  "recreational",
  "amateur",
  "intermediate",
  "advanced",
];

export const LEVEL_CONSTANTS = {
  /** How far back the rolling peak looks. Long enough that illness or a
   *  holiday cannot reclassify an athlete; short enough that real detraining
   *  eventually does. */
  PEAK_WINDOW_WEEKS: 12,
  /** Weekly-hours ceiling as a multiple of the rolling peak. */
  HEADROOM: 1.3,
  /** Upper bound of each band, in trailing weekly hours. */
  HOURS_BANDS: [
    { max: 3, level: "recreational" as AthleteLevel },
    { max: 5, level: "amateur" as AthleteLevel },
    { max: 9, level: "intermediate" as AthleteLevel },
    { max: Infinity, level: "advanced" as AthleteLevel },
  ],
  /** Upper bound of each band, in CTL. */
  CTL_BANDS: [
    { max: 35, level: "recreational" as AthleteLevel },
    { max: 55, level: "amateur" as AthleteLevel },
    { max: 80, level: "intermediate" as AthleteLevel },
    { max: Infinity, level: "advanced" as AthleteLevel },
  ],
} as const;

export interface LevelInput {
  /** Weekly training hours, oldest first. De-duplicated by the caller. */
  weeklyHoursByWeek: number[];
  /** Weekly CTL, oldest first. */
  ctlByWeek: number[];
  override: AthleteLevel | null;
}

export interface LevelResult {
  level: AthleteLevel | null;
  peakHours: number | null;
  /**
   * Weekly-hours ceiling, peakHours × HEADROOM. Level-INDEPENDENT: non-null
   * whenever any usable hours history exists, including while `source` is
   * "calibrating". Null only when there is no usable hours history at all.
   */
  ceilingHours: number | null;
  /** peakHours × MAINTENANCE_FLOOR. Null exactly when ceilingHours is null. */
  floorHours: number | null;
  source: "override" | "computed" | "calibrating";
}

function bandFor(
  value: number,
  bands: readonly { max: number; level: AthleteLevel }[]
): AthleteLevel {
  for (const band of bands) {
    if (value < band.max) return band.level;
  }
  return bands[bands.length - 1].level;
}

function peakOf(series: number[], weeks: number): number | null {
  const window = series.slice(-weeks);
  if (window.length === 0) return null;
  return Math.max(...window);
}

export function athleteLevel(input: LevelInput): LevelResult {
  const peakHours = peakOf(
    input.weeklyHoursByWeek,
    LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS
  );
  const peakCtl = peakOf(input.ctlByWeek, LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS);

  // The ceiling is what actually bounds volume, and it needs measured hours.
  // Without them there is no ceiling, whatever the override says.
  const ceilingHours =
    peakHours == null ? null : peakHours * LEVEL_CONSTANTS.HEADROOM;

  if (input.override != null) {
    return {
      level: input.override,
      peakHours,
      ceilingHours,
      source: "override",
    };
  }

  if (peakHours == null || peakCtl == null) {
    return {
      level: null,
      peakHours,
      ceilingHours,
      source: "calibrating",
    };
  }

  // The lower of the two verdicts. High CTL from short hard sessions must not
  // claim four-hour-ride capacity; many easy hours must not claim VO2max
  // tolerance.
  const fromHours = bandFor(peakHours, LEVEL_CONSTANTS.HOURS_BANDS);
  const fromCtl = bandFor(peakCtl, LEVEL_CONSTANTS.CTL_BANDS);
  const level =
    ORDER.indexOf(fromHours) <= ORDER.indexOf(fromCtl) ? fromHours : fromCtl;

  return { level, peakHours, ceilingHours, source: "computed" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/athlete-level.test.ts
```

Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/athlete-level.ts src/lib/athlete-level.test.ts
npm run typecheck
git add src/lib/athlete-level.ts src/lib/athlete-level.test.ts
git commit -m "feat(athlete): derived level and continuous volume ceiling"
```

---

### Task 6: Weekly target hours

**Files:**

- Create: `src/lib/week-plan/volume.ts`
- Test: `src/lib/week-plan/volume.test.ts`

**Interfaces:**

- Consumes: nothing (pure; callers supply the numbers from Tasks 3 and 5).
- Produces:

```ts
export interface VolumeInput {
  raceDemandHours: number | null;
  ceilingHours: number | null;
  /** MAINTENANCE_FLOOR × rolling peak; null when there is no measured peak. */
  floorHours: number | null;
  availabilityHours: number;
  fallbackHours: number;
}
export interface VolumeResult {
  hours: number;
  source: "race" | "ceiling" | "floor" | "availability" | "fallback";
  shortfall: { wantedHours: number; offeredHours: number } | null;
}
export function weeklyTargetHours(input: VolumeInput): VolumeResult;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/week-plan/volume.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { weeklyTargetHours } from "./volume";

const base = {
  raceDemandHours: null,
  ceilingHours: null,
  floorHours: null,
  availabilityHours: 12.5,
  fallbackHours: 10,
};

describe("weeklyTargetHours", () => {
  it("is a no-op without race demand — today's behaviour exactly", () => {
    // THE ROLLOUT SAFETY PROPERTY. Every existing plan must be untouched
    // until someone enters a distance.
    const r = weeklyTargetHours(base);
    expect(r.hours).toBe(10);
    expect(r.source).toBe("fallback");
    expect(r.shortfall).toBeNull();
  });

  it("uses race demand when it is known and under the ceiling", () => {
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 11,
      ceilingHours: 11.6,
    });
    expect(r.hours).toBe(11);
    expect(r.source).toBe("race");
  });

  it("clamps race demand to the ceiling", () => {
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 18,
      ceilingHours: 11.6,
    });
    expect(r.hours).toBe(11.6);
    expect(r.source).toBe("ceiling");
  });

  it("SUPPRESSES race demand when there is no measured ceiling", () => {
    // A brand-new athlete who logs an alpine tour must not be handed ~11h/week
    // on no evidence. This is the largest injury risk in the design.
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 11,
      ceilingHours: null,
    });
    expect(r.hours).toBe(10);
    expect(r.source).toBe("fallback");
  });

  it("floors a short event so it cannot prescribe a detraining week", () => {
    // A criterium demands ~2h. The athlete's peak is 8.9h, so the floor is
    // 5.3h. Prescribing 2h would actively cost them fitness.
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 2.1,
      ceilingHours: 11.6,
      floorHours: 5.3,
      availabilityHours: 12.5,
    });
    expect(r.hours).toBeCloseTo(5.3, 5);
  });

  it("does not let the floor exceed the ceiling", () => {
    const r = weeklyTargetHours({
      ...base,
      raceDemandHours: 1,
      ceilingHours: 4,
      floorHours: 9,
      availabilityHours: 20,
    });
    expect(r.hours).toBeLessThanOrEqual(4);
  });

  it("caps at availability and reports the shortfall", () => {
    const r = weeklyTargetHours({
      raceDemandHours: 11,
      ceilingHours: 13,
      floorHours: null,
      availabilityHours: 7,
      fallbackHours: 10,
    });
    expect(r.hours).toBe(7);
    expect(r.source).toBe("availability");
    expect(r.shortfall).toEqual({ wantedHours: 11, offeredHours: 7 });
  });

  it("leaves surplus availability unused", () => {
    // Availability is a ceiling, never a target. A free Saturday must not
    // override a recovery week.
    const r = weeklyTargetHours({
      raceDemandHours: 10,
      ceilingHours: 13,
      floorHours: null,
      availabilityHours: 20,
      fallbackHours: 8,
    });
    expect(r.hours).toBe(10);
    expect(r.shortfall).toBeNull();
  });

  it("never returns a negative or non-finite target", () => {
    const r = weeklyTargetHours({
      raceDemandHours: null,
      ceilingHours: null,
      floorHours: null,
      availabilityHours: -5,
      fallbackHours: 0,
    });
    expect(r.hours).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.hours)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/week-plan/volume.test.ts
```

Expected: FAIL — `Cannot find module './volume'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/week-plan/volume.ts`:

```ts
/**
 * This week's training-hours target.
 *
 *   target  = min(race demand, measured ceiling)
 *   planned = min(target, availability)
 *
 * Availability is a CEILING, never a target — the same rule JOIN states
 * explicitly. Letting an empty Saturday raise the number would mean a free
 * weekend overrides a recovery week and the missed-week restart. The fix for
 * "I offered twelve hours and got five" is a correct demand figure plus saying
 * out loud when the ceiling binds, which `shortfall` carries.
 *
 * Pure — no I/O, no clock.
 */

export interface VolumeInput {
  /** From the event demand model. null when no event has a distance yet. */
  raceDemandHours: number | null;
  /** From the athlete's rolling peak. null when there is too little history. */
  ceilingHours: number | null;
  /**
   * Never prescribe less than this. The demand model is volume-only, so a
   * criterium reads as almost no demand (2.1 h/week for an athlete who trains
   * 9) and prescribing it would be a DETRAINING plan. Detraining research sets
   * the level: a 70% volume reduction with intensity maintained preserves
   * VO2max, and 50-75% of normal volume shows no aerobic loss.
   */
  floorHours: number | null;
  /** This week's resolved availability, in hours. */
  availabilityHours: number;
  /** `constraints.hoursPerWeek` — the pre-existing behaviour. */
  fallbackHours: number;
}

export interface VolumeResult {
  hours: number;
  /** Which input bound the result; drives the legibility surface. */
  /** Which input bound the result; drives the legibility surface. */
  source: "race" | "ceiling" | "floor" | "availability" | "fallback";
  shortfall: { wantedHours: number; offeredHours: number } | null;
}

export function weeklyTargetHours(input: VolumeInput): VolumeResult {
  const availability = Math.max(0, input.availabilityHours);
  const fallback = Math.max(0, input.fallbackHours);

  // A null ceiling SUPPRESSES race demand rather than being bypassed.
  //
  // Writing this as `min(demand, ceiling ?? Infinity)` would hand a brand-new
  // athlete who logs an alpine tour ~11h/week on no evidence at all — the
  // largest injury risk in this design, aimed at precisely the athlete least
  // able to absorb it. With no measured ceiling we fall back to the plan's own
  // figure and let the shortfall line explain why.
  let target: number;
  let source: VolumeResult["source"];

  if (input.ceilingHours == null || input.raceDemandHours == null) {
    target = fallback;
    source = "fallback";
  } else if (input.raceDemandHours <= input.ceilingHours) {
    target = input.raceDemandHours;
    source = "race";
  } else {
    target = input.ceilingHours;
    source = "ceiling";
  }

  if (availability < target) {
    return {
      hours: availability,
      source: "availability",
      shortfall: { wantedHours: target, offeredHours: availability },
    };
  }

  return { hours: target, source, shortfall: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/week-plan/volume.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/week-plan/volume.ts src/lib/week-plan/volume.test.ts
npm run typecheck
git add src/lib/week-plan/volume.ts src/lib/week-plan/volume.test.ts
git commit -m "feat(week-plan): derive the weekly hours target from event demand"
```

---

### Task 7: The feasibility verdict

**Files:**

- Create: `src/lib/race/feasibility.ts`
- Test: `src/lib/race/feasibility.test.ts`

**Interfaces:**

- Consumes: `EventDemand` from Task 3; `RAMP_CLAMP_PCT` from `src/lib/week-plan/types.ts` (value `0.2`).
- Produces:

```ts
export type Verdict = "ready" | "on_track" | "tight" | "not_realistic";
export interface FeasibilityInput {
  requiredWeeklyHours: number;
  currentWeeklyHours: number | null;
  queenStageHours: number;
  queenStageKnown: boolean;
  longestRideHours: number | null;
  weeksUntilEvent: number;
}
export interface Feasibility {
  verdict: Verdict;
  volumeWeeksNeeded: number;
  longestRideWeeksNeeded: number;
  weeksUntilEvent: number;
  requiredLongestRideHours: number;
  /** True when queenStageHours is an average, not a known hardest day. */
  fromAverageDay: boolean;
}
export const FEASIBILITY_CONSTANTS: {
  LONGEST_RIDE_FRACTION: number;
  TIGHT_MARGIN_WEEKS: number;
};
export function assessFeasibility(input: FeasibilityInput): Feasibility | null;
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/race/feasibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assessFeasibility, FEASIBILITY_CONSTANTS } from "./feasibility";

const base = {
  requiredWeeklyHours: 11,
  currentWeeklyHours: 8.9,
  queenStageHours: 7,
  queenStageKnown: true,
  longestRideHours: 5,
  weeksUntilEvent: 8,
};

describe("assessFeasibility", () => {
  it("says ready when both requirements are already met", () => {
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 12,
      longestRideHours: 7,
    })!;
    expect(r.verdict).toBe("ready");
  });

  it("says on track when the plan closes both gaps in time", () => {
    const r = assessFeasibility(base)!;
    expect(r.verdict).toBe("on_track");
    expect(r.volumeWeeksNeeded).toBeGreaterThan(0);
  });

  it("says not realistic when the gap cannot close in time", () => {
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 2,
      longestRideHours: 1,
      weeksUntilEvent: 3,
    })!;
    expect(r.verdict).toBe("not_realistic");
  });

  it("says tight when it closes with no margin", () => {
    // Needs exactly the weeks available, within the tight band.
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 6,
      longestRideHours: 3.6,
      weeksUntilEvent: 4,
    })!;
    expect(["tight", "not_realistic"]).toContain(r.verdict);
  });

  it("judges longest ride separately from volume", () => {
    // Plenty of volume, but only ever in short rides — not prepared for a
    // seven-hour mountain day. AMENDED: volume is already satisfied, so the
    // ride gap softens ONE step (ready -> on_track) rather than condemning the
    // event. LONGEST_RIDE_FRACTION is the weakest constant in this feature and
    // the sources contradict each other; see spec 1.6.
    const r = assessFeasibility({
      ...base,
      currentWeeklyHours: 14,
      longestRideHours: 1.5,
      weeksUntilEvent: 2,
    })!;
    expect(r.verdict).toBe("on_track");
    expect(r.longestRideWeeksNeeded).toBeGreaterThan(2);
  });

  it("requires only a fraction of the queen stage, not all of it", () => {
    const r = assessFeasibility(base)!;
    expect(r.requiredLongestRideHours).toBeCloseTo(
      7 * FEASIBILITY_CONSTANTS.LONGEST_RIDE_FRACTION,
      5
    );
  });

  it("flags reasoning from an average day when stages are unknown", () => {
    const r = assessFeasibility({ ...base, queenStageKnown: false })!;
    expect(r.fromAverageDay).toBe(true);
  });

  it("returns null rather than a verdict without measured history", () => {
    expect(
      assessFeasibility({
        ...base,
        currentWeeklyHours: null,
        longestRideHours: null,
      })
    ).toBeNull();
  });

  it("does not divide by zero when the event is this week", () => {
    const r = assessFeasibility({ ...base, weeksUntilEvent: 0 })!;
    expect(Number.isFinite(r.volumeWeeksNeeded)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/race/feasibility.test.ts
```

Expected: FAIL — `Cannot find module './feasibility'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/race/feasibility.ts`:

```ts
/**
 * Can this athlete finish this event?
 *
 * The question anyone entering a hard event actually has, and the one nothing
 * in the app answers today.
 *
 * Two INDEPENDENT gaps. Volume alone is not preparation: eleven hours a week
 * ridden as five two-hour sessions does not ready anyone for a seven-hour
 * mountain stage. That is what the queen stage is for, and why per-day event
 * detail is worth entering.
 *
 * Weeks-to-close follows from the ramp guard the engine already enforces
 * (RAMP_CLAMP_PCT, ±20% week over week):
 *
 *   weeksNeeded = ceil( ln(required / current) / ln(1 + RAMP_CLAMP_PCT) )
 *
 * This INFORMS and never blocks. It does not refuse to build a plan or prevent
 * entering an event — an athlete is entitled to attempt something ambitious
 * having been told plainly what it asks.
 *
 * Pure — no I/O, no clock.
 */
import { RAMP_CLAMP_PCT } from "@/lib/week-plan/types";

export type Verdict = "ready" | "on_track" | "tight" | "not_realistic";

export const FEASIBILITY_CONSTANTS = {
  /** Longest training ride needed, as a share of the hardest event day. */
  LONGEST_RIDE_FRACTION: 0.8,
  /** Spare weeks below which "on track" becomes "tight". */
  TIGHT_MARGIN_WEEKS: 2,
} as const;

export interface FeasibilityInput {
  requiredWeeklyHours: number;
  /** The athlete's rolling peak weekly hours. */
  currentWeeklyHours: number | null;
  queenStageHours: number;
  queenStageKnown: boolean;
  /** Longest single ride in the recent window, in hours. */
  longestRideHours: number | null;
  weeksUntilEvent: number;
}

export interface Feasibility {
  verdict: Verdict;
  volumeWeeksNeeded: number;
  longestRideWeeksNeeded: number;
  weeksUntilEvent: number;
  requiredLongestRideHours: number;
  fromAverageDay: boolean;
}

/** Weeks of compounding ramp-guard growth to get from `current` to `required`. */
function weeksToGrow(current: number, required: number): number {
  if (current >= required) return 0;
  if (current <= 0) return Infinity;
  return Math.ceil(Math.log(required / current) / Math.log(1 + RAMP_CLAMP_PCT));
}

export function assessFeasibility(input: FeasibilityInput): Feasibility | null {
  // No measured history means no honest verdict. Same rule as the ceiling:
  // absent evidence, say nothing rather than guess.
  if (input.currentWeeklyHours == null || input.longestRideHours == null) {
    return null;
  }

  const requiredLongestRideHours =
    input.queenStageHours * FEASIBILITY_CONSTANTS.LONGEST_RIDE_FRACTION;

  const volumeWeeksNeeded = weeksToGrow(
    input.currentWeeklyHours,
    input.requiredWeeklyHours
  );
  const longestRideWeeksNeeded = weeksToGrow(
    input.longestRideHours,
    requiredLongestRideHours
  );
  const weeksUntilEvent = Math.max(0, input.weeksUntilEvent);

  // AMENDED after Task 7 was dispatched. This originally read
  //   const weeksNeeded = Math.max(volumeWeeksNeeded, longestRideWeeksNeeded);
  // which gave the longest-ride rule EQUAL FOOTING with volume, letting it
  // alone drive "not_realistic". That contradicts spec 1.6: the evidence is
  // genuinely contested — gran fondo coaching calls the long ride the biggest
  // single predictor of finishing, CTS says there is nothing magical about a
  // percentage of event distance and 3-hour rides can prepare you for a
  // century. A rule that disputed does not get to tell an athlete their event
  // is impossible. Volume decides the rung; the ride gap softens it by one.
  const RUNGS: Verdict[] = ["ready", "on_track", "tight", "not_realistic"];

  let volumeVerdict: Verdict;
  if (volumeWeeksNeeded === 0) {
    volumeVerdict = "ready";
  } else if (volumeWeeksNeeded > weeksUntilEvent) {
    volumeVerdict = "not_realistic";
  } else if (
    weeksUntilEvent - volumeWeeksNeeded <
    FEASIBILITY_CONSTANTS.TIGHT_MARGIN_WEEKS
  ) {
    volumeVerdict = "tight";
  } else {
    volumeVerdict = "on_track";
  }

  // One step worse, floored at "tight", and never better than volume alone.
  const rideGap = longestRideWeeksNeeded > weeksUntilEvent;
  const softenedIndex = Math.min(
    RUNGS.indexOf(volumeVerdict) + 1,
    RUNGS.indexOf("tight")
  );
  const verdict = rideGap
    ? RUNGS[Math.max(RUNGS.indexOf(volumeVerdict), softenedIndex)]
    : volumeVerdict;

  return {
    verdict,
    volumeWeeksNeeded,
    longestRideWeeksNeeded,
    weeksUntilEvent,
    requiredLongestRideHours,
    fromAverageDay: !input.queenStageKnown,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/race/feasibility.test.ts
```

Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/race/feasibility.ts src/lib/race/feasibility.test.ts
npm run typecheck
git add src/lib/race/feasibility.ts src/lib/race/feasibility.test.ts
git commit -m "feat(race): feasibility verdict for an event"
```

---

### Task 8: Assemble the athlete's history and the event's demand

**Files:**

- Create: `src/lib/week-plan/volume-inputs.ts`
- Test: `tests/volume-inputs.test.ts`

**Interfaces:**

- Consumes: `eventDemand` (Task 3), `athleteLevel` (Task 5), `dedupeActivities` from `src/lib/training-load.ts`, `schema` from `src/lib/db`.
- Produces:

```ts
export interface VolumeInputsResult {
  demand: EventDemand | null;
  level: LevelResult;
  longestRideHours: number | null;
  targetRace: { id: string; name: string; date: string } | null;
}
export async function assembleVolumeInputs(
  userId: string,
  now: Date
): Promise<VolumeInputsResult>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/volume-inputs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { weeklyHoursByWeek } from "@/lib/week-plan/volume-inputs";

// weeklyHoursByWeek is the pure half of this module and is exported for
// exactly this reason: the DB half needs a database, this does not.
describe("weeklyHoursByWeek", () => {
  const iso = (d: string) => new Date(d + "T10:00:00Z");

  it("buckets activities into Monday-first weeks, oldest first", () => {
    const out = weeklyHoursByWeek(
      [
        { provider: "strava", startDate: iso("2026-07-20"), durationS: 3600 },
        { provider: "strava", startDate: iso("2026-07-21"), durationS: 3600 },
        { provider: "strava", startDate: iso("2026-07-27"), durationS: 7200 },
      ],
      new Date("2026-08-02T10:00:00Z"),
      2
    );
    expect(out).toEqual([2, 2]);
  });

  it("counts a ride synced by two providers once", () => {
    const out = weeklyHoursByWeek(
      [
        {
          provider: "intervals_icu",
          startDate: iso("2026-07-27"),
          durationS: 7200,
        },
        { provider: "strava", startDate: iso("2026-07-27"), durationS: 7200 },
      ],
      new Date("2026-08-02T10:00:00Z"),
      1
    );
    expect(out).toEqual([2]);
  });

  it("emits a zero for a week with no activity, never a gap", () => {
    const out = weeklyHoursByWeek(
      [{ provider: "strava", startDate: iso("2026-07-27"), durationS: 3600 }],
      new Date("2026-08-02T10:00:00Z"),
      3
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/volume-inputs.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/week-plan/volume-inputs'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/week-plan/volume-inputs.ts`:

```ts
/**
 * Gathers everything the volume model needs, in one place, so the pure
 * modules stay pure: event demand, the athlete's rolling peak, and their
 * longest recent ride.
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { dedupeActivities } from "@/lib/training-load";
import { eventDemand, type EventDemand } from "@/lib/race/demand";
import {
  athleteLevel,
  LEVEL_CONSTANTS,
  type AthleteLevel,
  type LevelResult,
} from "@/lib/athlete-level";

/** Monday of the week containing `d`, at local midnight. */
function weekStartOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

export interface HistoryActivity {
  provider: string;
  startDate: Date;
  durationS: number | null;
}

/**
 * Training hours per week for the last `weeks` weeks, oldest first, one entry
 * per week including zeros. De-duplicated across providers first: the same
 * ride reaches us once per connected service, and this feeds the level model.
 */
export function weeklyHoursByWeek(
  activities: HistoryActivity[],
  now: Date,
  weeks: number
): number[] {
  const thisWeek = weekStartOf(now);
  const buckets = new Array<number>(weeks).fill(0);

  const unique = dedupeActivities(
    activities.map((a) => ({
      provider: a.provider,
      startDate: a.startDate,
      durationS: a.durationS,
      load: null,
      avgHr: null,
      avgPower: null,
    }))
  );

  for (const a of unique) {
    const start = weekStartOf(a.startDate);
    const weeksAgo = Math.round(
      (thisWeek.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000)
    );
    const idx = weeks - 1 - weeksAgo;
    if (idx < 0 || idx >= weeks) continue;
    buckets[idx] += (a.durationS ?? 0) / 3600;
  }
  return buckets;
}

/** Longest single de-duplicated ride in the window, in hours. */
export function longestRideHoursOf(
  activities: HistoryActivity[]
): number | null {
  const unique = dedupeActivities(
    activities.map((a) => ({
      provider: a.provider,
      startDate: a.startDate,
      durationS: a.durationS,
      load: null,
      avgHr: null,
      avgPower: null,
    }))
  );
  let longest = 0;
  for (const a of unique)
    longest = Math.max(longest, (a.durationS ?? 0) / 3600);
  return longest > 0 ? longest : null;
}

export interface VolumeInputsResult {
  demand: EventDemand | null;
  level: LevelResult;
  longestRideHours: number | null;
  targetRace: { id: string; name: string; date: string } | null;
}

export async function assembleVolumeInputs(
  userId: string,
  now: Date
): Promise<VolumeInputsResult> {
  const weeks = LEVEL_CONSTANTS.PEAK_WINDOW_WEEKS;
  const floor = new Date(now);
  floor.setDate(floor.getDate() - weeks * 7);

  const [rows, wellness, prefs, races] = await Promise.all([
    db.query.activities.findMany({
      where: and(
        eq(schema.activities.userId, userId),
        gte(schema.activities.startDate, floor)
      ),
    }),
    db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        gte(schema.wellnessDaily.date, floor)
      ),
      orderBy: desc(schema.wellnessDaily.date),
    }),
    db.query.bodyPrefs.findFirst({
      where: eq(schema.bodyPrefs.userId, userId),
    }),
    db.query.races.findMany({
      where: and(
        eq(schema.races.userId, userId),
        eq(schema.races.status, "upcoming")
      ),
    }),
  ]);

  const history: HistoryActivity[] = rows.map((r) => ({
    provider: r.provider,
    startDate: r.startDateLocal ?? r.startDate,
    durationS: r.durationS,
  }));

  // CTL per week: the highest value seen in each week is what the rolling
  // peak wants, and wellness rows are daily.
  const ctlBuckets = new Array<number>(weeks).fill(0);
  const thisWeek = weekStartOf(now);
  for (const w of wellness) {
    if (w.ctl == null) continue;
    const start = weekStartOf(new Date(w.date));
    const idx =
      weeks -
      1 -
      Math.round(
        (thisWeek.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000)
      );
    if (idx < 0 || idx >= weeks) continue;
    ctlBuckets[idx] = Math.max(ctlBuckets[idx], w.ctl);
  }

  const level = athleteLevel({
    weeklyHoursByWeek: weeklyHoursByWeek(history, now, weeks),
    ctlByWeek: ctlBuckets,
    override: (prefs?.levelOverride as AthleteLevel | null) ?? null,
  });

  // Highest priority first, then nearest date — the same ordering the taper
  // uses, so there is one rule for "the race we are training for", not two.
  const order = { A: 0, B: 1, C: 2 } as const;
  const target =
    [...races].sort(
      (a, b) =>
        order[a.priority] - order[b.priority] || a.date.localeCompare(b.date)
    )[0] ?? null;

  let demand: EventDemand | null = null;
  if (target) {
    const stages = await db.query.raceStages.findMany({
      where: eq(schema.raceStages.raceId, target.id),
    });
    const latestWeight = wellness.find((w) => w.weightKg != null)?.weightKg;
    const latestEftp = wellness.find((w) => w.eftp != null)?.eftp;
    demand = eventDemand({
      eventDays: target.eventDays ?? 1,
      distanceKm: target.distanceKm,
      elevationM: target.elevationM,
      stages: stages.map((s) => ({
        dayNumber: s.dayNumber,
        distanceKm: s.distanceKm,
        elevationM: s.elevationM,
      })),
      overrideWeeklyHours: target.demandHoursOverride,
      ftpWatts:
        prefs?.ftpWatts ?? (latestEftp != null ? Math.round(latestEftp) : null),
      // Rider weight plus an allowance for bike and kit.
      massKg: latestWeight != null ? latestWeight + 8 : null,
    });
  }

  return {
    demand,
    level,
    longestRideHours: longestRideHoursOf(history),
    targetRace: target
      ? { id: target.id, name: target.name, date: String(target.date) }
      : null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/volume-inputs.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/week-plan/volume-inputs.ts tests/volume-inputs.test.ts
npm run typecheck
git add src/lib/week-plan/volume-inputs.ts tests/volume-inputs.test.ts
git commit -m "feat(week-plan): assemble event demand and athlete history"
```

---

### Task 9: Wire the derived target into the weekly rollover

**Files:**

- Modify: `src/lib/training-plan.ts:116` (export `periodize`)
- Modify: `src/lib/week-plan/service.ts` (`rolloverWeekPlan`, ~lines 240–290)
- Test: `src/lib/week-plan/rollover-volume.test.ts`

**Interfaces:**

- Consumes: `assembleVolumeInputs` (Task 8), `weeklyTargetHours` (Task 6), `periodize` (newly exported).
- Produces: no new exports; `rolloverWeekPlan` now derives `hoursPerWeek` and the skeleton rather than reading stored values.

- [ ] **Step 1: Export `periodize`**

In `src/lib/training-plan.ts` line 116, change:

```ts
function periodize(
```

to:

```ts
/**
 * Exported so the weekly rollover can recompute the skeleton fresh rather
 * than reading `training_blocks` as authority. Pure: the same inputs always
 * yield the same blocks, and `startingCtl` is a fixed historical fact, so a
 * recomputation only moves when demand or ceiling genuinely moves.
 */
export function periodize(
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/week-plan/rollover-volume.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { periodize } from "@/lib/training-plan";

describe("periodize under a derived hours target", () => {
  it("is deterministic for identical inputs", () => {
    const a = periodize(9, 76.7, 4, 10, "century", ["Bike"]);
    const b = periodize(9, 76.7, 4, 10, "century", ["Bike"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a bigger week-5 target for a bigger hours figure", () => {
    const small = periodize(9, 76.7, 4, 6, "century", ["Bike"]);
    const large = periodize(9, 76.7, 4, 12, "century", ["Bike"]);
    const w5s = small.find((b) => b.weekNumber === 5)!;
    const w5l = large.find((b) => b.weekNumber === 5)!;
    const mins = (b: typeof w5s) =>
      b.workouts.reduce((s, w) => s + w.durationMins, 0);
    expect(mins(w5l)).toBeGreaterThan(mins(w5s));
  });

  it("still marks week 4 of a 9-week plan a recovery week", () => {
    // Guards the existing periodisation while the hours input changes.
    const blocks = periodize(9, 76.7, 4, 10, "century", ["Bike"]);
    expect(blocks.find((b) => b.weekNumber === 4)!.phase).toBe("recovery");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run src/lib/week-plan/rollover-volume.test.ts
```

Expected: FAIL — `periodize` is not exported.

- [ ] **Step 4: Wire the rollover**

In `src/lib/week-plan/service.ts`, add imports:

```ts
import { periodize } from "@/lib/training-plan";
import { assembleVolumeInputs } from "./volume-inputs";
import { weeklyTargetHours } from "./volume";
```

In `rolloverWeekPlan`, insert the following immediately after
`availableBlocksPerDay` is computed (it is built from `dates`/`resolved`, a few
lines below `const constraints = planConstraints(plan.constraints);`). Do NOT
move the `constraints` line — it already precedes `availableBlocksPerDay`, so
both names are in scope at the insertion point:

```ts
// Derive this week's hours target rather than reading a number typed once
// at plan creation. With no event demand and no measured ceiling this
// returns `constraints.hoursPerWeek` — today's behaviour, unchanged.
const volumeInputs = await assembleVolumeInputs(userId, now);
const availabilityHours =
  availableBlocksPerDay.reduce(
    (s, blocks) => s + dayMins({ availableBlocks: blocks }),
    0
  ) / 60;
const target = weeklyTargetHours({
  raceDemandHours: volumeInputs.demand?.weeklyHours ?? null,
  ceilingHours: volumeInputs.level.ceilingHours,
  floorHours: volumeInputs.level.floorHours,
  availabilityHours,
  fallbackHours: constraints.hoursPerWeek,
});
```

Leave the stored-skeleton lookup and its `if (!skeleton) return "skipped";`
guard exactly as they are. `weeksTotal` is `notNull` in the schema, so that
lookup is not a "weeksTotal is unknown" fallback — it is the gate that decides
whether this plan has any blocks at all, and removing it would make the
rollover materialize a week for a plan that was never periodized. Leave the
persisted `skeletonWeek: skeleton.weekNumber` on the stored value too: the
adherence loop in step 1 looks blocks up by that number, so it must keep
pointing at a row that exists in `training_blocks`.

Replace the stored-skeleton lookup. The existing block that reads
`db.query.trainingBlocks.findFirst(...)` stays as a fallback for plans whose
`weeksTotal` is unknown, but the skeleton actually used becomes:

```ts
// Recomputed fresh, never read as authority — a stored target is exactly
// how `hoursPerWeek` went stale in the first place.
const derivedBlocks = periodize(
  plan.weeksTotal,
  plan.startingCtl ?? 0,
  constraints.daysPerWeek,
  target.hours,
  plan.raceType,
  constraints.sports
);
const derived =
  derivedBlocks.find((b) => b.weekNumber === plan.currentWeek) ??
  derivedBlocks[derivedBlocks.length - 1];
```

Then change the `materializeWeek` call's `skeleton` and `hoursPerWeek`:

```ts
    skeleton: {
      weekNumber: derived.weekNumber,
      phase: derived.phase,
      targetLoadTotal: derived.targetLoad,
      targetSessions: derived.targetSessions,
    },
    ...
    hoursPerWeek: target.shortfall?.wantedHours ?? target.hours,
```

**Pass the PRE-availability figure, not `target.hours`.** `weeklyTargetHours`
applies availability last, and `materializeWeek` already applies it too — it
computes `hoursBudget` from exactly the same `dayMins` sum and, when
`hoursBudget < neededHours`, scales `effectiveLoad` down and pushes the
`"Xh available instead of Yh — week load lowered to Z"` adjustment that tells
the athlete why their week shrank.

Handing `materializeWeek` an already-clamped number makes `neededHours` fall to
`hoursBudget`, so that branch stops firing: the week keeps its full skeleton
load, adherence is then scored against a target the athlete had no time to
reach, and the explanatory adjustment disappears. `shortfall.wantedHours` is
the demand/ceiling/floor/fallback figure with availability not yet applied, so
this keeps availability enforced in exactly one place — the place that already
explains itself. `weeklyTargetHours`'s own availability clamp stays: it is what
drives `source: "availability"` and the Task 11 shortfall line.

- [ ] **Step 5: Guard the availability regression**

Nothing above would fail if a later edit "simplified" `hoursPerWeek` back to
`target.hours`, so pin the behaviour that choice protects. Append to
`src/lib/week-plan/materialize.test.ts` (reuse the file's existing `baseInput`
and `blocksPerDay` helpers):

```ts
describe("materializeWeek availability scaling (Task 9 regression)", () => {
  // 6h of availability against a 10h week. materializeWeek is the ONE place
  // availability lowers the week's load, which is why rolloverWeekPlan hands
  // it the pre-availability target.
  const sixHours = blocksPerDay([60, 60, 60, 60, 60, 60, 0]);

  it("lowers the week load, and says so, when time is short", () => {
    const r = materializeWeek({
      ...baseInput,
      hoursPerWeek: 10,
      availableBlocksPerDay: sixHours,
    });
    // needed 10h vs 6h budget: 400 × 6/10 = 240
    expect(r.effectiveLoad).toBe(240);
    expect(
      r.adjustments.some((a) => a.reason.includes("available instead of"))
    ).toBe(true);
  });

  it("does nothing once the target has already been clamped to availability", () => {
    // The defect this guards: pre-clamping to 6h makes the branch above
    // unreachable, so the week keeps its full 400 load with only 6h to ride
    // it and the athlete is never told why.
    const r = materializeWeek({
      ...baseInput,
      hoursPerWeek: 6,
      availableBlocksPerDay: sixHours,
    });
    expect(r.effectiveLoad).toBe(400);
    expect(
      r.adjustments.some((a) => a.reason.includes("available instead of"))
    ).toBe(false);
  });
});
```

If either expected number does not hold, STOP and report rather than adjusting
it — the numbers are hand-computed from `neededHours = hoursPerWeek × (load /
targetLoadTotal)` and a disagreement means the model moved, not the test.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/lib/week-plan/rollover-volume.test.ts
npx vitest run src/lib/week-plan/
```

Expected: 3 new `rollover-volume` tests and 2 new `materialize` tests PASS;
every existing week-plan test still passes.

- [ ] **Step 7: Full gate and commit**

`npm run build` is REQUIRED here and is not optional: `tsc` does not model the
`"use server"` rule that every export be async, and only the build catches a
violation. This repo has already shipped one broken release that way.

```bash
npx prettier --write src/lib/training-plan.ts src/lib/week-plan/service.ts src/lib/week-plan/rollover-volume.test.ts src/lib/week-plan/materialize.test.ts
npm run typecheck && npm run lint && npm test && npm run build
git add src/lib/training-plan.ts src/lib/week-plan/service.ts src/lib/week-plan/rollover-volume.test.ts src/lib/week-plan/materialize.test.ts
git commit -m "feat(week-plan): derive the weekly skeleton at rollover, never from a stored target"
```

---

### Task 10: Event details on the race form

**Files:**

- Modify: `src/components/plan/races-section.tsx`
- Modify: `src/app/plan/actions.ts` (`addRace`, plus a new `setRaceDemand`)
- Test: `src/components/plan/races-section.test.tsx` (add cases)

**Interfaces:**

- Consumes: `schema.races`, `schema.raceStages`. `RacesSection`'s props are
  `{ races: RaceListItem[]; hideHeading?: boolean }` — it takes no `sports`
  prop; do not add one.
- Produces: `addRace` gains the event-demand fields, so its input becomes
  `{ name; raceType; date; priority; goalNote?; eventDays: number; distanceKm: number | null; elevationM: number | null; stages: { dayNumber: number; distanceKm: number | null; elevationM: number | null }[] }`,
  return type unchanged.

**Do NOT add a separate exported `setRaceDemand` server action.** An earlier
draft of this task did, and nothing would have called it: `RacesSection` has
only an add form, no edit form. In a `"use server"` file every export is a
reachable RPC endpoint, so a dead one is attack surface with no consumer. This
branch has already shipped one field with no producer; this is the same defect
inverted. `createRace` returns `{ race: RaceRow }`, so `addRace` already has
the new race's id in hand and can write the demand in the same call — no id
round-trip to the client and no window where a race exists without its demand.
When an edit form arrives, the edit action arrives with it.

- [ ] **Step 1: Write the failing test**

**`@testing-library/react` is NOT a dependency of this repo** — do not import
`render`, `screen`, or `userEvent`, and do not install it. The existing
`src/components/plan/races-section.test.tsx` uses `renderToString`, which
cannot drive interaction. The repo's idiom for interactive component tests is
hand-rolled `react-dom/client` + `act()`; copy it from
`tests/journal-form.test.tsx`.

Create a NEW file `src/components/plan/races-section-demand.test.tsx` (leaving
the existing `renderToString` file untouched — the `@vitest-environment`
pragma is file-level):

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "use server" is a genuine module boundary, not the logic under test; the
// write path has its own DB coverage. Stubbed the same way journal-form does.
vi.mock("@/app/plan/actions", () => ({
  addRace: vi.fn(async () => ({ ok: true })),
  removeRace: vi.fn(async () => {}),
  setRaceStatus: vi.fn(async () => ({ ok: true })),
}));

import { RacesSection } from "./races-section";
import { addRace } from "@/app/plan/actions";

const addRaceMock = vi.mocked(addRace);

let root: Root | null = null;
let container: HTMLDivElement;

async function open() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RacesSection races={[]} />);
  });
  await click("Add race");
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
  vi.clearAllMocks();
});

const byId = (id: string): HTMLInputElement => {
  const el = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`no field with id ${id}`);
  return el;
};

const byLabel = (label: string): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);

async function click(text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  );
  if (!btn) throw new Error(`no button containing "${text}"`);
  await act(async () => {
    btn.click();
  });
}

async function set(el: HTMLInputElement, value: string) {
  await act(async () => {
    // React tracks the previous value on the DOM node; bypass its setter or
    // the synthetic change event is swallowed as a no-op.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("RacesSection event demand", () => {
  it("captures days, distance and elevation for an event", async () => {
    await open();
    expect(byId("event-days")).toBeTruthy();
    expect(byId("event-distance")).toBeTruthy();
    expect(byId("event-elevation")).toBeTruthy();
  });

  it("only offers per-day stages once the event runs over more than one day", async () => {
    await open();
    expect(container.textContent).not.toContain("Per-day detail");
    await set(byId("event-days"), "8");
    expect(container.textContent).toContain("Per-day detail");
    expect(byLabel("Day 8 distance in km")).toBeTruthy();
  });

  it("sends the demand fields to addRace, not just to local state", async () => {
    // The defect this pins: fields that render, hold state, and are never
    // submitted. Rendering proves nothing about persistence.
    await open();
    await set(byId("race-name"), "Alpine Tour");
    await set(byId("race-date"), "2026-09-01");
    await set(byId("event-days"), "2");
    await set(byId("event-distance"), "220");
    await set(byId("event-elevation"), "5000");
    await set(byLabel("Day 1 distance in km")!, "100");
    await set(byLabel("Day 2 distance in km")!, "120");

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(addRaceMock).toHaveBeenCalledTimes(1);
    const arg = addRaceMock.mock.calls[0][0];
    expect(arg.eventDays).toBe(2);
    expect(arg.distanceKm).toBe(220);
    expect(arg.elevationM).toBe(5000);
    expect(arg.stages).toEqual([
      { dayNumber: 1, distanceKm: 100, elevationM: null },
      { dayNumber: 2, distanceKm: 120, elevationM: null },
    ]);
  });

  it("sends no stages for a one-day event", async () => {
    await open();
    await set(byId("race-name"), "Gran Fondo");
    await set(byId("race-date"), "2026-09-01");
    await set(byId("event-distance"), "130");
    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(addRaceMock.mock.calls[0][0].eventDays).toBe(1);
    expect(addRaceMock.mock.calls[0][0].stages).toEqual([]);
  });
});
```

The existing form's name and date inputs may not carry `id` attributes yet. If
they do not, add `id="race-name"` and `id="race-date"` to them (with matching
`htmlFor` on their labels) as part of Step 4 — that is an accessibility
improvement the form wants anyway, not scope creep.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/components/plan/races-section.test.tsx
```

Expected: FAIL — the fields do not exist.

- [ ] **Step 3: Extend `addRace` to persist the demand**

In `src/app/plan/actions.ts` (a `"use server"` file — **every export must be
an async function**; only `npm run build` catches a violation, so keep the
helper below unexported, matching the existing non-async `revalidatePlan`).

Widen `addRace`'s input with the four demand fields and write them after
`createRace` returns. `createRace` yields `{ race: RaceRow }`, so its id is
already in hand:

```ts
export async function addRace(input: {
  name: string;
  raceType: string;
  date: string;
  priority: "A" | "B" | "C";
  goalNote?: string;
  eventDays: number;
  distanceKm: number | null;
  elevationM: number | null;
  stages: {
    dayNumber: number;
    distanceKm: number | null;
    elevationM: number | null;
  }[];
}): Promise<Result> {
  const user = await requireUser();
  if (!Number.isInteger(input.eventDays) || input.eventDays < 1) {
    return { ok: false, error: "An event runs over at least one day." };
  }
  if (input.distanceKm != null && input.distanceKm < 0) {
    return { ok: false, error: "Distance cannot be negative." };
  }
  if (input.elevationM != null && input.elevationM < 0) {
    return { ok: false, error: "Elevation cannot be negative." };
  }

  const result = await createRace(user.id, {
    name: input.name,
    raceType: input.raceType,
    date: input.date,
    priority: input.priority,
    goalNote: input.goalNote ?? null,
  });
  if ("error" in result) return { ok: false, error: result.error };

  await db
    .update(schema.races)
    .set({
      eventDays: input.eventDays,
      distanceKm: input.distanceKm,
      elevationM: input.elevationM,
      updatedAt: new Date(),
    })
    .where(eq(schema.races.id, result.race.id));

  // Stages are replaced wholesale. `createRace` upserts on
  // (userId, date, name), so re-adding the same race reuses its row — a
  // partial write would leave a stale day 7 behind when an eight-day event is
  // re-entered as six.
  await db
    .delete(schema.raceStages)
    .where(eq(schema.raceStages.raceId, result.race.id));
  if (input.stages.length > 0) {
    await db.insert(schema.raceStages).values(
      input.stages.map((s) => ({
        raceId: result.race.id,
        dayNumber: s.dayNumber,
        distanceKm: s.distanceKm,
        elevationM: s.elevationM,
      }))
    );
  }

  revalidatePath("/train");
  revalidatePath("/");
  return { ok: true };
}
```

Keep whatever `db`/`schema`/`eq` imports this needs; check what the file
already imports before adding.

- [ ] **Step 4: Add the form fields**

In `src/components/plan/races-section.tsx`, inside the add/edit race form, after the date field:

```tsx
<label className="label-micro" htmlFor="event-days">
  Days
</label>
<input
  id="event-days"
  type="number"
  min={1}
  value={eventDays}
  onChange={(e) => setEventDays(Math.max(1, Number(e.target.value) || 1))}
  className="w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm"
/>

<label className="label-micro" htmlFor="event-distance">
  Total distance (km)
</label>
<input
  id="event-distance"
  type="number"
  min={0}
  value={distanceKm ?? ""}
  onChange={(e) =>
    setDistanceKm(e.target.value === "" ? null : Number(e.target.value))
  }
  className="w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm"
/>

<label className="label-micro" htmlFor="event-elevation">
  Total elevation (m)
</label>
<input
  id="event-elevation"
  type="number"
  min={0}
  value={elevationM ?? ""}
  onChange={(e) =>
    setElevationM(e.target.value === "" ? null : Number(e.target.value))
  }
  className="w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm"
/>

{eventDays > 1 && (
  <details className="mt-3">
    <summary className="label-micro cursor-pointer">
      Per-day detail (optional)
    </summary>
    <p className="mt-1 text-[11px] text-white/50">
      Enter each day and we can tell you what your longest training ride needs
      to be. Without it we assume every day is the average.
    </p>
    {Array.from({ length: eventDays }, (_, i) => (
      <div key={i} className="mt-2 flex items-center gap-2">
        <span className="w-12 text-[11px] text-white/50">{`Day ${i + 1}`}</span>
        <input
          aria-label={`Day ${i + 1} distance in km`}
          type="number"
          min={0}
          value={stages[i]?.distanceKm ?? ""}
          onChange={(e) => setStageField(i, "distanceKm", e.target.value)}
          className="w-24 rounded-lg bg-white/[0.06] px-2 py-1 text-[12px]"
        />
        <input
          aria-label={`Day ${i + 1} elevation in m`}
          type="number"
          min={0}
          value={stages[i]?.elevationM ?? ""}
          onChange={(e) => setStageField(i, "elevationM", e.target.value)}
          className="w-24 rounded-lg bg-white/[0.06] px-2 py-1 text-[12px]"
        />
      </div>
    ))}
  </details>
)}
```

with the state and helper at the top of the component:

```tsx
const [eventDays, setEventDays] = useState(1);
const [distanceKm, setDistanceKm] = useState<number | null>(null);
const [elevationM, setElevationM] = useState<number | null>(null);
const [stages, setStages] = useState<
  { distanceKm: number | null; elevationM: number | null }[]
>([]);

function setStageField(
  index: number,
  field: "distanceKm" | "elevationM",
  raw: string
) {
  const value = raw === "" ? null : Number(raw);
  setStages((prev) => {
    const next = [...prev];
    while (next.length <= index) {
      next.push({ distanceKm: null, elevationM: null });
    }
    next[index] = { ...next[index], [field]: value };
    return next;
  });
}
```

Then **wire it into the submit path** — this is the step whose omission the
Step 1 tests exist to catch. In `handleAdd`, extend the existing `addRace({…})`
call with the demand fields:

```tsx
const result = await addRace({
  // …the existing name/raceType/date/priority/goalNote fields, unchanged…
  eventDays,
  distanceKm,
  elevationM,
  stages: stagesForSubmit(),
});
```

with, alongside `setStageField`:

```tsx
/**
 * Per-day rows as the server wants them. A one-day event has no stages by
 * definition, and a multi-day event nobody filled in sends none rather than a
 * row of nulls per day — `eventDemand` reads an empty list as "no per-day
 * detail" and falls back to the average day, which is exactly right.
 */
function stagesForSubmit() {
  if (eventDays <= 1) return [];
  const rows = Array.from({ length: eventDays }, (_, i) => ({
    dayNumber: i + 1,
    distanceKm: stages[i]?.distanceKm ?? null,
    elevationM: stages[i]?.elevationM ?? null,
  }));
  return rows.some((r) => r.distanceKm != null || r.elevationM != null)
    ? rows
    : [];
}
```

Reset the new state alongside whatever `handleAdd` already resets on success,
so a second race does not inherit the first one's distance.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/components/plan/races-section.test.tsx src/components/plan/races-section-demand.test.tsx
```

Expected: all tests PASS, including the two that assert `addRace` actually
received the demand fields.

Then grep for every other caller of `addRace` — widening its input is a
breaking change, and `npm run typecheck` must come back clean:

```bash
grep -rn "addRace" src --include=*.tsx --include=*.ts
```

- [ ] **Step 6: Full gate and commit**

```bash
npx prettier --write src/components/plan/races-section.tsx src/app/plan/actions.ts src/components/plan/races-section-demand.test.tsx
npm run typecheck && npm run lint && npm test && npm run build
git add src/components/plan/races-section.tsx src/app/plan/actions.ts src/components/plan/races-section-demand.test.tsx
git commit -m "feat(plan): capture event days, distance, elevation and per-day stages"
```

---

### Task 11: Show the week its own reasons

**Files:**

- Create: `src/components/plan/week-rationale.tsx`
- Create: `src/components/plan/week-rationale.test.tsx`
- Modify: `src/app/train/page.tsx` (render it under the week grid)

**Interfaces:**

- Consumes: `schema.planAdjustments` rows for the open week.
- Produces: `<WeekRationale reasons={string[]} targetHours={number} plannedHours={number} />`.

**Why this task exists:** the engine already logged `"last week was fully missed — restarting at 60% of the skeleton target (244)"` and `"3.1h available instead of 6.0h — week load lowered to 244"`. Nothing ever rendered them. That silence is why a small week reads as a bug rather than an explanation.

- [ ] **Step 1: Write the failing test**

Create `src/components/plan/week-rationale.test.tsx`:

**`@testing-library/react` is NOT a dependency of this repo** — do not import
`render`, `screen`, `userEvent`, or jest-dom matchers like
`toBeInTheDocument` / `toBeEmptyDOMElement`, and do not install anything.
`WeekRationale` holds no state and has no handlers, so `renderToString` is the
right tool; it is what `src/components/plan/races-section.test.tsx` already
uses.

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WeekRationale } from "./week-rationale";

describe("WeekRationale", () => {
  it("shows every reason the engine recorded", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[
          "last week was fully missed — restarting at 60% of the skeleton target (244)",
          "3.1h available instead of 6.0h — week load lowered to 244",
        ]}
        targetHours={6}
        plannedHours={4.9}
        shortfall={null}
        raceName={null}
      />
    );
    expect(html).toContain("fully missed");
    expect(html).toContain("3.1h available");
  });

  it("states planned against target", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={11}
        plannedHours={11}
        shortfall={null}
        raceName={null}
      />
    );
    expect(html).toContain("11h planned against an 11h target");
  });

  it("states the shortfall plainly when availability capped the week", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={7}
        plannedHours={7}
        shortfall={{ wantedHours: 11, offeredHours: 7 }}
        raceName="Dolomites"
      />
    );
    expect(html).toContain("Dolomites asks about 11h");
    expect(html).toContain("not race it");
  });

  it("names no event it was not given", () => {
    // The shortfall sentence must still work before a race is entered.
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={7}
        plannedHours={7}
        shortfall={{ wantedHours: 11, offeredHours: 7 }}
        raceName={null}
      />
    );
    expect(html).toContain("asks about 11h");
    expect(html).not.toContain("null");
  });

  it("renders nothing when there is nothing to explain", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={null}
        plannedHours={null}
        shortfall={null}
        raceName={null}
      />
    );
    expect(html).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/components/plan/week-rationale.test.tsx
```

Expected: FAIL — `Cannot find module './week-rationale'`.

- [ ] **Step 3: Write the component**

Create `src/components/plan/week-rationale.tsx`:

```tsx
/**
 * Why this week looks the way it does.
 *
 * Every reason here was already being written to `plan_adjustments` — the
 * engine has always logged its own arithmetic accurately. It was simply never
 * shown, which is why an unexpectedly small week reads as a bug instead of a
 * recovery week following a missed one.
 */
interface Props {
  reasons: string[];
  targetHours: number | null;
  plannedHours: number | null;
  /** From weeklyTargetHours: set when availability capped the target. */
  shortfall: { wantedHours: number; offeredHours: number } | null;
  /** Name of the event being trained for, for the shortfall sentence. */
  raceName: string | null;
}

function fmt(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

/** "a 6h target" but "an 11h target". */
function article(hours: number): string {
  return fmt(hours).startsWith("8") || fmt(hours).startsWith("11")
    ? "an"
    : "a";
}

export function WeekRationale({
  reasons,
  targetHours,
  plannedHours,
  shortfall,
  raceName,
}: Props) {
  if (reasons.length === 0 && targetHours == null && shortfall == null) {
    return null;
  }

  return (
    <div className="glass mt-4 rounded-[1.5rem] p-5">
      <p className="label-micro mb-2">Why this week</p>
      {plannedHours != null && targetHours != null && (
        <p className="mb-2 text-[12.5px] text-white/70">
          {`${fmt(plannedHours)} planned against ${article(targetHours)} ${fmt(
            targetHours
          )} target.`}
        </p>
      )}
      {shortfall && (
        <p className="mb-2 text-[12.5px] text-white/70">
          {`${raceName ?? "Your event"} asks about ${fmt(
            shortfall.wantedHours
          )} a week. Your calendar offers ${fmt(
            shortfall.offeredHours
          )} — enough to ride it, not race it.`}
        </p>
      )}
      <ul className="space-y-1">
        {reasons.map((reason) => (
          <li
            key={reason}
            className="text-[11.5px] leading-relaxed text-white/55"
          >
            {reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**The shortfall block is the point of this task's `shortfall`/`raceName`
props.** An earlier draft declared both and rendered neither, so the test
asserting the sentence would have failed against a component that looked
complete. This branch has shipped a declared-with-no-producer defect once
already; do not let the props drift back out of the body.

- [ ] **Step 4: Render it on the train page**

`src/app/train/page.tsx` gets the open week from `getOpenWeekPlan(userId)` at
line 232 and renders `<WeekDayList days={week.days} />` at line 380. None of
`targetHours`, `plannedHours`, `shortfall` or the race name exist on that page
yet — the page must derive them itself, the same way `rolloverWeekPlan` does.
Add this inside the branch where `week` is non-null:

```tsx
const [adjustmentRows, volumeInputs] = await Promise.all([
  db.query.planAdjustments.findMany({
    where: eq(schema.planAdjustments.weekPlanId, week.id),
  }),
  assembleVolumeInputs(userId, new Date()),
]);
const reasons = adjustmentRows
  .filter(
    (a) =>
      a.trigger === "weekly_rollover" || a.trigger === "availability_change"
  )
  .map((a) => a.reason);

// The same figures the rollover derived, recomputed for display. Reading
// them off the stored week instead would show a target that no longer
// matches what the athlete's calendar and races now say.
const availabilityHours =
  week.days.reduce((s, d) => s + d.availableMins, 0) / 60;
const target = weeklyTargetHours({
  raceDemandHours: volumeInputs.demand?.weeklyHours ?? null,
  ceilingHours: volumeInputs.level.ceilingHours,
  floorHours: volumeInputs.level.floorHours,
  availabilityHours,
  fallbackHours: availabilityHours,
});
const plannedHours =
  week.days.reduce(
    (s, d) => s + d.workouts.reduce((t, w) => t + w.durationMins, 0),
    0
  ) / 60;
```

`fallbackHours` is the week's own availability here rather than
`constraints.hoursPerWeek`: this page has no plan constraints in scope, and a
fallback equal to availability makes `weeklyTargetHours` return the honest "no
race, no ceiling — nothing to explain" case instead of inventing a target.
`reason` is `notNull` in the schema, so no null-filter is needed.

Render it directly under `<WeekDayList days={week.days} />`:

```tsx
<WeekRationale
  reasons={reasons}
  targetHours={target.hours}
  plannedHours={plannedHours}
  shortfall={target.shortfall}
  raceName={volumeInputs.targetRace?.name ?? null}
/>
```

Add the imports it needs: `assembleVolumeInputs` from
`@/lib/week-plan/volume-inputs`, `weeklyTargetHours` from
`@/lib/week-plan/volume`, and `WeekRationale`. `eq`, `db` and `schema` are
already imported.

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run src/components/plan/week-rationale.test.tsx
```

Expected: 5 tests PASS.

- [ ] **Step 6: Full gate and commit**

```bash
npx prettier --write src/components/plan/week-rationale.tsx src/components/plan/week-rationale.test.tsx src/app/train/page.tsx
npm run typecheck && npm run lint && npm test && npm run build
git add src/components/plan/week-rationale.tsx src/components/plan/week-rationale.test.tsx src/app/train/page.tsx
git commit -m "feat(plan): surface the week's own reasons instead of leaving them in the log"
```

---

### Task 12: The feasibility verdict on screen

**Files:**

- Create: `src/components/plan/event-readiness.tsx`
- Create: `src/components/plan/event-readiness.test.tsx`
- Modify: `src/app/train/page.tsx`

**Interfaces:**

- Consumes: `Feasibility` (Task 7), `EventDemand` (Task 3), `assembleVolumeInputs` (Task 8).
- Produces: `<EventReadiness raceName={string} feasibility={Feasibility} demand={EventDemand} />`.

- [ ] **Step 1: Write the failing test**

Create `src/components/plan/event-readiness.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventReadiness } from "./event-readiness";

const demand = {
  totalHours: 50,
  dailyRateHours: 6.3,
  queenStageHours: 7,
  queenStageKnown: true,
  weeklyHours: 11,
  source: "computed" as const,
};

const feasibility = {
  verdict: "on_track" as const,
  volumeWeeksNeeded: 2,
  longestRideWeeksNeeded: 3,
  weeksUntilEvent: 8,
  requiredLongestRideHours: 5.6,
  fromAverageDay: false,
};

describe("EventReadiness", () => {
  it("names the event and what it asks per week", () => {
    render(
      <EventReadiness
        raceName="Dolomites"
        feasibility={feasibility}
        demand={demand}
      />
    );
    expect(screen.getByText(/Dolomites/)).toBeInTheDocument();
    expect(screen.getByText(/11h/)).toBeInTheDocument();
  });

  it("states the longest-ride requirement, not just volume", () => {
    render(
      <EventReadiness
        raceName="Dolomites"
        feasibility={feasibility}
        demand={demand}
      />
    );
    expect(screen.getByText(/longest ride/i)).toBeInTheDocument();
  });

  it("is explicit and unhedged when the event is not realistic", () => {
    render(
      <EventReadiness
        raceName="Dolomites"
        feasibility={{
          ...feasibility,
          verdict: "not_realistic",
          weeksUntilEvent: 3,
        }}
        demand={demand}
      />
    );
    expect(screen.getByText(/not realistic/i)).toBeInTheDocument();
  });

  it("says when it is reasoning from an average day", () => {
    render(
      <EventReadiness
        raceName="Dolomites"
        feasibility={{ ...feasibility, fromAverageDay: true }}
        demand={{ ...demand, queenStageKnown: false }}
      />
    );
    expect(screen.getByText(/average day/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/components/plan/event-readiness.test.tsx
```

Expected: FAIL — `Cannot find module './event-readiness'`.

- [ ] **Step 3: Write the component**

Create `src/components/plan/event-readiness.tsx`:

```tsx
import type { Feasibility } from "@/lib/race/feasibility";
import type { EventDemand } from "@/lib/race/demand";

interface Props {
  raceName: string;
  feasibility: Feasibility;
  demand: EventDemand;
}

const VERDICT_COPY: Record<Feasibility["verdict"], string> = {
  ready: "You are ready for this.",
  on_track: "On track — the plan gets you there.",
  tight: "Tight. One missed week and it slips.",
  not_realistic: "Not realistic from here.",
};

const VERDICT_TONE: Record<Feasibility["verdict"], string> = {
  ready: "text-emerald-400",
  on_track: "text-emerald-400/80",
  tight: "text-amber-300",
  not_realistic: "text-red-400",
};

function fmt(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function EventReadiness({ raceName, feasibility, demand }: Props) {
  const { verdict, weeksUntilEvent, requiredLongestRideHours } = feasibility;

  return (
    <div className="glass mt-4 rounded-[1.5rem] p-5">
      <p className="label-micro mb-1">{raceName}</p>
      <p className={`mb-2 text-[13px] font-bold ${VERDICT_TONE[verdict]}`}>
        {VERDICT_COPY[verdict]}
      </p>
      <p className="text-[11.5px] leading-relaxed text-white/60">
        {`Asks about ${fmt(demand.weeklyHours)} a week, and a longest ride of about ${fmt(requiredLongestRideHours)}. ${weeksUntilEvent} weeks to go.`}
      </p>
      {verdict === "not_realistic" && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-white/60">
          {`Closing the gap needs ${Math.max(feasibility.volumeWeeksNeeded, feasibility.longestRideWeeksNeeded)} weeks of steady building, and there are ${weeksUntilEvent}. You can still ride it — go in knowing what it asks.`}
        </p>
      )}
      {feasibility.fromAverageDay && (
        <p className="mt-2 text-[11px] text-white/40">
          Reasoning from an average day — add per-day distance and climbing to
          this event for a sharper longest-ride target.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Render it on the train page**

In `src/app/train/page.tsx`, after loading `assembleVolumeInputs`:

```tsx
{
  inputs.targetRace && inputs.demand && feasibility && (
    <EventReadiness
      raceName={inputs.targetRace.name}
      feasibility={feasibility}
      demand={inputs.demand}
    />
  );
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npx vitest run src/components/plan/event-readiness.test.tsx
```

Expected: 4 tests PASS.

- [ ] **Step 6: Full gate and commit**

```bash
npx prettier --write src/components/plan/event-readiness.tsx src/components/plan/event-readiness.test.tsx src/app/train/page.tsx
npm run typecheck && npm run lint && npm test && npm run build
git add src/components/plan/event-readiness.tsx src/components/plan/event-readiness.test.tsx src/app/train/page.tsx
git commit -m "feat(plan): show whether an event is reachable from here"
```

---

## Verification before release

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` — all green
- [ ] Migration applied against the dev database and `tests/race-demand-schema.test.ts` passes
- [ ] **Inertness check:** on a plan with no event distance, the derived target equals `constraints.hoursPerWeek` and the week materialises identically to before
- [ ] **Calibration check:** enter 8 days / 900km / 20,000hm and confirm the weekly target lands between 9 and 12 hours
- [ ] Bump `version` in `package.json`, add the `CHANGELOG.md` entry, update `docs/ROADMAP.md`
- [ ] Merge to `main`, verify `main` is green, and only then tag — the image builds from the tag

---

### Task 13: A continuous duration model, and per-day pricing for stage events

**Added 2026-07-28**, after Tasks 2-6 shipped. Two coupled corrections to the
demand model. The user delegated both calls; the reasoning is in the spec and
in `docs/specs/2026-07-28-training-volume-evidence.md`.

**Why:** `FTP_FRACTION` is a step function, so an event landing near a band
edge is unstable — 114km predicted 4.985h and 116km predicted 5.424h, an 8.8%
jump for 1.75% more distance. The calibration athlete's Dolomites day sits
1.6% under the 5h edge, so the tour's whole estimate hangs on that cliff.
Separately, `eventDemand` priced a multi-day event without stage data as ONE
continuous ride, charging an 8-day tour the deep-fatigue fraction it would
earn only by riding 42 hours without sleeping.

**Files:**

- Modify: `src/lib/race/demand-constants.ts` (replace `FTP_FRACTION`)
- Modify: `src/lib/race/riding-time.ts` (`ftpFractionFor`, export it)
- Modify: `src/lib/race/riding-time.test.ts` (add continuity cases)
- Modify: `src/lib/race/demand.ts` (per-day pricing when stages are absent)
- Modify: `src/lib/race/demand.test.ts` (two expectations move — see Step 5)

**Interfaces:**

- `ftpFractionFor` becomes exported so continuity can be tested directly.
- `FTP_FRACTION` is deleted and replaced by `FTP_FRACTION_ANCHORS`.
- `eventDemand`'s signature is unchanged; only the no-stage path changes.

- [ ] **Step 1: Replace the bands with anchors**

In `src/lib/race/demand-constants.ts`, delete `FTP_FRACTION` and add:

```ts
  /**
   * Sustainable share of FTP against the duration of a CONTINUOUS effort,
   * as interpolation anchors rather than steps. Same three fractions the
   * step bands used; the difference is that they are now reached smoothly.
   *
   * Stepping made estimates unstable at the edges: 114km predicted 4.985h
   * and 116km predicted 5.424h, an 8.8% jump for 1.75% more distance.
   *
   * Flat below the first anchor and above the last. The flat tail matters:
   * extrapolating the decline out to a 42-hour "ride" would produce a
   * sustainable fraction no rider could be measured at, and the demand model
   * must never be handed a duration it treats as one continuous effort when
   * it is not. The 8h anchor is where 0.68 becomes fully effective and is
   * LOW CONFIDENCE — it is a reading of what the old `>5h` band meant, not a
   * published figure.
   */
  FTP_FRACTION_ANCHORS: [
    { hours: 3, fraction: 0.85 },
    { hours: 5, fraction: 0.75 },
    { hours: 8, fraction: 0.68 },
  ],
```

- [ ] **Step 2: Interpolate**

In `src/lib/race/riding-time.ts`, replace `ftpFractionFor` with:

```ts
/**
 * Sustainable share of FTP for a continuous effort of `hours`, linearly
 * interpolated between the anchors and held flat outside them.
 */
export function ftpFractionFor(hours: number): number {
  const anchors = C.FTP_FRACTION_ANCHORS;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!(hours > first.hours)) return first.fraction;
  if (hours >= last.hours) return last.fraction;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (hours <= b.hours) {
      const t = (hours - a.hours) / (b.hours - a.hours);
      return a.fraction + t * (b.fraction - a.fraction);
    }
  }
  return last.fraction;
}
```

`!(hours > first.hours)` rather than `hours <= first.hours` so a NaN duration
returns the most conservative (highest) fraction instead of falling through.

- [ ] **Step 3: Test the interpolation**

Append to `src/lib/race/riding-time.test.ts`:

```ts
import { ftpFractionFor } from "./riding-time";

describe("ftpFractionFor", () => {
  it("returns exactly the anchor fraction at each anchor", () => {
    expect(ftpFractionFor(3)).toBeCloseTo(0.85, 10);
    expect(ftpFractionFor(5)).toBeCloseTo(0.75, 10);
    expect(ftpFractionFor(8)).toBeCloseTo(0.68, 10);
  });

  it("is flat outside the anchor range", () => {
    expect(ftpFractionFor(0.5)).toBeCloseTo(0.85, 10);
    expect(ftpFractionFor(1)).toBeCloseTo(0.85, 10);
    expect(ftpFractionFor(20)).toBeCloseTo(0.68, 10);
    expect(ftpFractionFor(42)).toBeCloseTo(0.68, 10);
  });

  it("interpolates rather than stepping between anchors", () => {
    // Midpoint of the 3-5h span is the midpoint of 0.85 and 0.75.
    expect(ftpFractionFor(4)).toBeCloseTo(0.8, 10);
    // The old step function returned 0.75 for both of these.
    expect(ftpFractionFor(4.99)).toBeGreaterThan(ftpFractionFor(5.01));
  });

  it("never jumps at an anchor, which is the whole point", () => {
    for (const edge of [3, 5, 8]) {
      const below = ftpFractionFor(edge - 0.01);
      const above = ftpFractionFor(edge + 0.01);
      expect(Math.abs(below - above)).toBeLessThan(0.005);
    }
  });

  it("never increases with duration", () => {
    let previous = Infinity;
    for (let h = 0.5; h <= 12; h += 0.1) {
      const f = ftpFractionFor(h);
      expect(f).toBeLessThanOrEqual(previous + 1e-12);
      previous = f;
    }
  });
});
```

And, in the `estimateRidingHours` describe block, the cliff that motivated all
of this:

```ts
  it("no longer jumps across the old 5-hour band edge", () => {
    // 114km predicted 4.985h and 116km predicted 5.424h under the step
    // function: 8.8% more time for 1.75% more distance. The response must
    // now be proportionate to the input.
    const shorter = estimateRidingHours({
      distanceKm: 114,
      elevationM: 2533,
      ...ATHLETE,
    })!;
    const longer = estimateRidingHours({
      distanceKm: 116,
      elevationM: 2578,
      ...ATHLETE,
    })!;
    expect(longer).toBeGreaterThan(shorter);
    expect(longer / shorter).toBeLessThan(1.05);
  });
```

- [ ] **Step 4: Price a stage event per day**

In `src/lib/race/demand.ts`, the branch that runs when no usable stages were
supplied currently estimates the whole event as one ride. Replace it so a
multi-day event is estimated as its average DAY, multiplied by the day count:

```ts
  if (totalHours == null) {
    // Without stage data, estimate the AVERAGE DAY and multiply. Pricing the
    // whole event as one continuous ride would charge an 8-day tour the
    // deep-fatigue fraction a rider earns only by riding 42 hours without
    // sleeping. The FTP ladder models within-ride fatigue; riders sleep
    // between stages.
    //
    // Cumulative fatigue across consecutive days is real and is NOT modelled
    // here — there is no published magnitude for it in the evidence base, and
    // inventing one by mispricing the duration is worse than omitting it.
    const perDay = estimateRidingHours({
      distanceKm: (input.distanceKm ?? 0) / days,
      elevationM: (input.elevationM ?? 0) / days,
      ftpWatts,
      massKg,
    });
    totalHours = perDay == null ? null : perDay * days;
  }
```

Use the same `days`, `ftpWatts` and `massKg` locals the surrounding code
already resolved. Do not change how `days` is derived or guarded.

- [ ] **Step 5: Update the two expectations this moves**

Both are in `src/lib/race/demand.test.ts`. **These are deliberate model
changes, not loosened bounds.** If any OTHER expectation fails, stop and
report.

a) The tour's daily rate. It was `> 5` because the whole-block price inflated
it to 5.26. Per-day it is 4.90:

```ts
    expect(d.dailyRateHours).toBeGreaterThan(4.5);
    expect(d.dailyRateHours).toBeLessThan(8);
```

b) The staged-versus-totals test. It currently asserts the two paths DIVERGE,
because they used to: one summed per-stage estimates while the other priced a
single long block, so they landed in different fatigue bands. Now both price
per day, so they agree to about 0.01h. Replace the two assertions and the
comment above them with:

```ts
    // Both paths now price per DAY — the stage loop uses the real stages, the
    // totals path uses the average day — so they agree closely. They are not
    // identical: unequal stages cost slightly more than their average.
    //
    // This assertion failed before Task 13 and is restored deliberately. The
    // original plan asserted it, Task 3 had to overturn it because the model
    // priced the two paths on different fatigue bands, and making the model
    // coherent has made it true again.
    expect(d.totalHours).toBeCloseTo(fromTotals.totalHours, 1);
```

- [ ] **Step 6: Run the gate**

```bash
npx vitest run src/lib/race/
npx vitest run
npx tsc --noEmit
```

Expected, for the calibration athlete (FTP 310W, 87kg):

| quantity                        | before | after |
| ------------------------------- | ------ | ----- |
| fondo 130km/4000m               | 6.82h  | 6.57h |
| tour day 112.5km/2500m          | 4.92h  | 4.90h |
| tour total (8 days)             | 42.09h | 39.18h |
| tour weeklyHours                | 16.8   | 15.68 |
| fondo weeklyHours               | 11.4   | 10.95 |
| whole-block 900km/20000m        | 42.09h | 42.09h (flat tail) |

The fondo and a flat century both stay inside the published 8-12 h/week band.
The tour still exceeds the ceiling and still reports the athlete
under-prepared — that conclusion is robust to both changes.

- [ ] **Step 7: Commit** (two commits — the ladder, then the pricing)

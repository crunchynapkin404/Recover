# Race Pacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the athlete how hard to go in their next race — a target and a
band, with the confidence and the assumption both visible.

**Architecture:** A pure module derives the target from maths that already
runs: `ftpFractionFor()` for the bike, Riegel for the run. It returns
`Figure<PacingTarget>`, so refusing is a first-class result rather than a gap.
A tool exposes it to the coach and MCP; the race card renders it.

**Tech Stack:** TypeScript, vitest, zod (tool parameters), drizzle (read-only).

**Spec:** `docs/specs/2026-08-20-race-pacing-design.md`

## Global Constraints

- **`PACING_BAND_FRACTION = 0.05`** — uncited, symmetric engineering bound,
  Confidence: Low. Documented as such, in the voice `forecast.ts` uses for
  `ADHERENCE_CEIL`. It does **not** vary with confidence.
- **Confidence never reaches `"high"`.** No path is measured against this
  athlete's own race results.
- **A band is an intensity range, never positional.** `races` stores total
  `distanceKm` and total `elevationM` — there is no course profile.
- **Triathlon and multi-day events refuse**, via `Figure.notApplicable` with a
  reason an athlete can read.
- **Pure module:** `src/lib/race/pacing.ts` does no I/O and reads no clock,
  matching `riding-time.ts` and `running-time.ts`.
- **`DEFAULT_MASS_KG = 83`** (`demand-constants.ts`) is the fallback mass, the
  same one `demand.ts:priceLeg` uses.

## File Structure

| Path                               | Responsibility                            |
| ---------------------------------- | ----------------------------------------- |
| `src/lib/race/pacing.ts`           | Pure. Target, band, confidence, refusals. |
| `src/lib/race/pacing.test.ts`      | Table-driven, colocated (house pattern).  |
| `src/lib/tools/get-race-pacing.ts` | One object serving coach + MCP.           |
| `src/lib/tools/registry.ts`        | Register the tool (import + array entry). |
| `src/lib/race/outlook.ts`          | `raceCard` gains the pacing figure.       |
| `src/app/train/page.tsx`           | Render the pacing line.                   |

---

### Task 1: The bike branch

**Files:**

- Create: `src/lib/race/pacing.ts`
- Create: `src/lib/race/pacing.test.ts`

**Interfaces:**

- Consumes: `ftpFractionFor(hours: number): number` and
  `estimateRidingHours(input: { distanceKm: number; elevationM: number; ftpWatts: number; massKg: number }): number | null`
  from `./riding-time`; `Figure` from `@/lib/uncertainty`;
  `DEMAND_CONSTANTS` from `./demand-constants`.
- Produces: `racePacing(input: PacingInput): Figure<PacingTarget>`,
  `PACING_BAND_FRACTION`, and the `PacingInput` / `PacingTarget` types that
  Tasks 2-5 all use.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/race/pacing.test.ts
import { describe, expect, it } from "vitest";
import { racePacing, PACING_BAND_FRACTION } from "./pacing";
import { ftpFractionFor } from "./riding-time";

const bike = (over: Partial<Parameters<typeof racePacing>[0]> = {}) =>
  racePacing({
    sport: "Bike",
    distanceKm: 90,
    elevationM: 900,
    eventDays: 1,
    ftpWatts: 250,
    massKg: 75,
    thresholdPaceSecPerKm: null,
    ...over,
  });

describe("racePacing — Bike", () => {
  it("targets a share of FTP, not FTP itself", () => {
    const r = bike();
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.value.sport).toBe("Bike");
    expect(r.value.targetWatts).toBeLessThan(250);
    expect(r.value.targetWatts).toBeGreaterThan(150);
  });

  // THE MUTATION THIS FILE EXISTS FOR. The likely defect is reading
  // INITIAL_FTP_FRACTION (0.75, the pre-iteration guess) instead of
  // ftpFractionFor(hours). A ~5h event resolves near 0.75, so a 5h fixture
  // CANNOT tell those apart — docs/RELEASING.md step 3 names exactly this
  // failure. These two sit where the values differ by 0.10 and 0.07.
  it("uses the resolved fraction, not the initial guess — short event", () => {
    const r = bike({ distanceKm: 55, elevationM: 300 });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.value.hours).toBeLessThan(3.5);
    expect(r.value.ftpFraction).toBeGreaterThan(0.8);
    expect(r.value.ftpFraction).toBe(ftpFractionFor(r.value.hours));
  });

  it("uses the resolved fraction, not the initial guess — long event", () => {
    const r = bike({ distanceKm: 210, elevationM: 3500 });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.value.hours).toBeGreaterThan(8);
    expect(r.value.ftpFraction).toBeCloseTo(0.68, 5);
    expect(r.value.ftpFraction).toBe(ftpFractionFor(r.value.hours));
  });

  it("brackets the target with a symmetric band", () => {
    const r = bike();
    expect(r.available).toBe(true);
    if (!r.available) return;
    const { targetWatts, lowWatts, highWatts } = r.value;
    expect(lowWatts).toBeLessThan(targetWatts);
    expect(highWatts).toBeGreaterThan(targetWatts);
    expect(targetWatts - lowWatts).toBeCloseTo(highWatts - targetWatts, 0);
    expect(highWatts - lowWatts).toBeCloseTo(
      2 * targetWatts * PACING_BAND_FRACTION,
      0
    );
  });

  it("reports low confidence past the 8h anchor, and says why", () => {
    const r = bike({ distanceKm: 210, elevationM: 3500 });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.confidence).toBe("low");
    expect(r.why).toMatch(/8 ?h|published/i);
  });

  it("reports medium confidence inside the anchors", () => {
    const r = bike();
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.confidence).toBe("medium");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/race/pacing.test.ts`
Expected: FAIL — cannot resolve `./pacing`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/race/pacing.ts
/**
 * How hard to go in this race — a target, a band around it, and the
 * assumption behind both.
 *
 * NOT A NEW MODEL. riding-time.ts already resolves a sustainable FTP fraction
 * by fixed-point iteration and returns only the hours; running-time.ts already
 * runs Riegel, which predicts race pace by construction. This module derives
 * what those already compute and wraps it in the uncertainty vocabulary.
 *
 * A band here is an INTENSITY RANGE, never positional. `races` stores total
 * distance and total elevation with no course profile, so "hold 210-225 W" is
 * supportable and "ease off on the climb at 40 km" would be invented.
 *
 * Pure — no I/O, no clock.
 */
import { Figure } from "@/lib/uncertainty";
import { DEMAND_CONSTANTS as C } from "./demand-constants";
import { estimateRidingHours, ftpFractionFor } from "./riding-time";

/**
 * Half-width of the pacing band, as a fraction of the target.
 *
 * UNCITED, SYMMETRIC ENGINEERING BOUND — Confidence: Low. There is no
 * published figure for how wide a pacing tolerance should be, and this is not
 * derived from anything. It is wide enough to hold on real terrain without a
 * power meter twitching the athlete around, and narrow enough that the top of
 * the band is not a different workout from the bottom. +/-5% of 250 W is
 * 237-263 W; of 5:00/km, 4:45-5:15.
 *
 * Same voice, and the same honesty, as forecast.ts's ADHERENCE_CEIL. It does
 * NOT widen with lower confidence — confidence is reported separately, in
 * words, because encoding it as a wider band would look derived.
 *
 * If it is ever measured, this comment is what should be deleted.
 */
export const PACING_BAND_FRACTION = 0.05;

export interface PacingInput {
  sport: "Bike" | "Run" | "Triathlon";
  distanceKm: number | null;
  elevationM: number | null;
  eventDays: number;
  ftpWatts: number | null;
  massKg: number | null;
  thresholdPaceSecPerKm: number | null;
}

export type PacingTarget =
  | {
      sport: "Bike";
      /** Whole watts — power meters do not show tenths. */
      targetWatts: number;
      lowWatts: number;
      highWatts: number;
      /** The resolved share of FTP this target represents. */
      ftpFraction: number;
      hours: number;
    }
  | {
      sport: "Run";
      /** Whole seconds per km. LOWER is faster, so lowSecPerKm is the FAST end. */
      targetSecPerKm: number;
      lowSecPerKm: number;
      highSecPerKm: number;
      hours: number;
    };

/** The 8h anchor's own words, repeated to the athlete rather than paraphrased. */
const LONG_EVENT_WHY =
  "Past 8 h the sustainable-effort figure is a reading of an older band, not a " +
  "published measurement — treat this as a starting point and adjust by feel.";

const BIKE_WHY =
  "Assumes a steady effort at a share of your FTP that falls as the event gets " +
  "longer, on a course averaged from its total distance and climbing.";

export function racePacing(input: PacingInput): Figure<PacingTarget> {
  const { sport, distanceKm, elevationM, ftpWatts, massKg } = input;

  if (sport === "Bike") {
    if (distanceKm == null || !(distanceKm > 0)) {
      return Figure.missingInput("this race's distance");
    }
    if (ftpWatts == null || !(ftpWatts > 0)) {
      return Figure.missingInput("your FTP");
    }
    const hours = estimateRidingHours({
      distanceKm,
      elevationM: elevationM ?? 0,
      ftpWatts,
      massKg: massKg ?? C.DEFAULT_MASS_KG,
    });
    if (hours == null) return Figure.missingInput("this race's distance");

    const ftpFraction = ftpFractionFor(hours);
    const targetWatts = Math.round(ftpWatts * ftpFraction);
    const half = targetWatts * PACING_BAND_FRACTION;
    const long =
      hours >= C.FTP_FRACTION_ANCHORS[C.FTP_FRACTION_ANCHORS.length - 1].hours;

    return Figure.available(
      {
        sport: "Bike",
        targetWatts,
        lowWatts: Math.round(targetWatts - half),
        highWatts: Math.round(targetWatts + half),
        ftpFraction,
        hours,
      },
      long ? "low" : "medium",
      long ? `${BIKE_WHY} ${LONG_EVENT_WHY}` : BIKE_WHY
    );
  }

  return Figure.notApplicable("Not supported for this sport yet.");
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/race/pacing.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the mutation test actually discriminates**

Temporarily replace `ftpFractionFor(hours)` with `C.INITIAL_FTP_FRACTION`:

Run: `npx vitest run src/lib/race/pacing.test.ts`
Expected: **FAIL** on both the short-event and long-event tests. Then revert.

If either still passes, the fixture cannot tell the two apart and the test is
worthless — fix the fixture before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/race/pacing.ts src/lib/race/pacing.test.ts
git commit -m "feat(race): pacing target and band for the bike

riding-time.ts already resolves a sustainable FTP fraction by fixed-point
iteration and returns only the hours. This derives the target from it.
Fixtures sit at 3h and 8h because a 5h event resolves near the 0.75
pre-iteration guess and could not tell the two apart."
```

---

### Task 2: The run branch

**Files:**

- Modify: `src/lib/race/pacing.ts`
- Modify: `src/lib/race/pacing.test.ts`

**Interfaces:**

- Consumes: `estimateRunningHours(input: { distanceKm: number; elevationM: number; thresholdPaceSecPerKm: number }): number | null` from `./running-time`.
- Produces: the `{ sport: "Run"; targetSecPerKm; lowSecPerKm; highSecPerKm; hours }`
  arm of `PacingTarget`, already declared in Task 1.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/race/pacing.test.ts`:

```ts
const run = (over: Partial<Parameters<typeof racePacing>[0]> = {}) =>
  racePacing({
    sport: "Run",
    distanceKm: 21.1,
    elevationM: 150,
    eventDays: 1,
    ftpWatts: null,
    massKg: null,
    thresholdPaceSecPerKm: 240,
    ...over,
  });

describe("racePacing — Run", () => {
  it("targets a pace slower than threshold for a half marathon", () => {
    const r = run();
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.value.sport).toBe("Run");
    // Threshold is ~1h race pace; a half takes longer, so pace must be slower
    // (a HIGHER seconds-per-km) than the 240 anchor.
    expect(r.value.targetSecPerKm).toBeGreaterThan(240);
  });

  // Riegel decays pace with distance. A 10k must be paced faster than a
  // marathon off the same threshold, or the model is not being consulted.
  it("paces a 10k faster than a marathon", () => {
    const short = run({ distanceKm: 10, elevationM: 0 });
    const long = run({ distanceKm: 42.2, elevationM: 0 });
    expect(short.available && long.available).toBe(true);
    if (!short.available || !long.available) return;
    expect(short.value.targetSecPerKm).toBeLessThan(long.value.targetSecPerKm);
  });

  // lowSecPerKm is the FAST end. Getting this backwards would tell an athlete
  // their easy end is their hard end, and no type would catch it.
  it("names the fast end low and the slow end high", () => {
    const r = run();
    expect(r.available).toBe(true);
    if (!r.available) return;
    const { targetSecPerKm, lowSecPerKm, highSecPerKm } = r.value;
    expect(lowSecPerKm).toBeLessThan(targetSecPerKm);
    expect(highSecPerKm).toBeGreaterThan(targetSecPerKm);
    expect(highSecPerKm - lowSecPerKm).toBeCloseTo(
      2 * targetSecPerKm * PACING_BAND_FRACTION,
      0
    );
  });

  it("is medium confidence and cites Riegel", () => {
    const r = run();
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.confidence).toBe("medium");
    expect(r.why).toMatch(/Riegel/i);
  });

  it("refuses without a threshold pace", () => {
    const r = run({ thresholdPaceSecPerKm: null });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.kind).toBe("missing_input");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/race/pacing.test.ts -t "Run"`
Expected: FAIL — the Run branch currently returns `notApplicable`.

- [ ] **Step 3: Implement the run branch**

Add the import at the top of `src/lib/race/pacing.ts`:

```ts
import { estimateRunningHours } from "./running-time";
```

Add the `why` constant beside the others:

```ts
const RUN_WHY =
  "Assumes an even effort at the pace Riegel's endurance model predicts for " +
  "this distance from your threshold pace, with climbing priced as extra flat " +
  "distance.";
```

Replace the final `return Figure.notApplicable(...)` with the Run branch,
leaving the fallback below it:

```ts
if (sport === "Run") {
  if (distanceKm == null || !(distanceKm > 0)) {
    return Figure.missingInput("this race's distance");
  }
  const secPerKm = input.thresholdPaceSecPerKm;
  if (secPerKm == null || !(secPerKm > 0)) {
    return Figure.missingInput("your threshold pace");
  }
  const hours = estimateRunningHours({
    distanceKm,
    elevationM: elevationM ?? 0,
    thresholdPaceSecPerKm: secPerKm,
  });
  if (hours == null) return Figure.missingInput("this race's distance");

  const targetSecPerKm = Math.round((hours * 3600) / distanceKm);
  const half = targetSecPerKm * PACING_BAND_FRACTION;

  return Figure.available(
    {
      sport: "Run",
      targetSecPerKm,
      // Lower seconds-per-km is FASTER. Named for speed, not for magnitude.
      lowSecPerKm: Math.round(targetSecPerKm - half),
      highSecPerKm: Math.round(targetSecPerKm + half),
      hours,
    },
    "medium",
    RUN_WHY
  );
}

return Figure.notApplicable("Not supported for this sport yet.");
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/race/pacing.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/race/pacing.ts src/lib/race/pacing.test.ts
git commit -m "feat(race): pacing target and band for the run

Riegel predicts race pace for a distance by construction, so the target
is the predicted average. Medium rather than high: Riegel is published,
but the ITRA km-effort conversion in front of it is not.

Guarded against naming the band backwards — lowSecPerKm is the FAST end,
and no type would catch that being inverted."
```

---

### Task 3: The refusals

**Files:**

- Modify: `src/lib/race/pacing.ts`
- Modify: `src/lib/race/pacing.test.ts`

**Interfaces:**

- Consumes: `Figure.notApplicable(why: string)` from `@/lib/uncertainty`.
- Produces: no new signatures. Later tasks rely on refusals carrying a
  human-readable `why`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/race/pacing.test.ts`:

```ts
describe("racePacing — when it refuses", () => {
  // Bike effort determines what is left for the run. A bike wattage computed
  // as though no run followed is not an incomplete answer, it is a harmful
  // one — so this refuses, and says why rather than showing a blank.
  it("refuses Triathlon, naming the bike-to-run coupling", () => {
    const r = racePacing({
      sport: "Triathlon",
      distanceKm: 113,
      elevationM: 900,
      eventDays: 1,
      ftpWatts: 250,
      massKg: 75,
      thresholdPaceSecPerKm: 240,
    });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.kind).toBe("not_applicable");
    if (r.kind !== "not_applicable") return;
    expect(r.why).toMatch(/run/i);
    expect(r.why.length).toBeGreaterThan(30);
  });

  // distanceKm is the TOTAL across days, so one sustainable intensity over it
  // is meaningless.
  it("refuses a multi-day event, naming the reason", () => {
    const r = racePacing({
      sport: "Bike",
      distanceKm: 600,
      elevationM: 9000,
      eventDays: 5,
      ftpWatts: 250,
      massKg: 75,
      thresholdPaceSecPerKm: null,
    });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.kind).toBe("not_applicable");
    if (r.kind !== "not_applicable") return;
    expect(r.why).toMatch(/day/i);
  });

  it("refuses a bike race with no FTP, and offers a fix", () => {
    const r = racePacing({
      sport: "Bike",
      distanceKm: 90,
      elevationM: 900,
      eventDays: 1,
      ftpWatts: null,
      massKg: 75,
      thresholdPaceSecPerKm: null,
    });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "missing_input") return;
    expect(r.needs).toMatch(/FTP/i);
    expect(r.fix?.href).toBeTruthy();
  });

  it("refuses a run with no threshold pace, and offers a fix", () => {
    const r = racePacing({
      sport: "Run",
      distanceKm: 21.1,
      elevationM: 0,
      eventDays: 1,
      ftpWatts: null,
      massKg: null,
      thresholdPaceSecPerKm: null,
    });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "missing_input") return;
    expect(r.needs).toMatch(/pace/i);
    expect(r.fix?.href).toBeTruthy();
  });

  it("refuses with no distance", () => {
    const r = racePacing({
      sport: "Bike",
      distanceKm: null,
      elevationM: 0,
      eventDays: 1,
      ftpWatts: 250,
      massKg: 75,
      thresholdPaceSecPerKm: null,
    });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "missing_input") return;
    expect(r.needs).toMatch(/distance/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/race/pacing.test.ts -t "refuses"`
Expected: FAIL — multi-day is not handled, Triathlon's reason is a stub, and
the `missingInput` calls carry no `fix`.

- [ ] **Step 3: Implement the refusals**

Add the constant beside the other `why` strings:

```ts
const TRIATHLON_WHY =
  "Triathlon pacing is not supported yet. How hard you ride determines what " +
  "is left for the run, and that link is not modelled — a bike target " +
  "worked out as if no run followed would be worse than no target at all.";

const MULTI_DAY_WHY =
  "This event runs over more than one day, and the distance recorded is the " +
  "total across all of them — a single sustainable effort for that total " +
  "would not describe any of the days.";

/** Where an athlete sets both anchors. */
const ANCHOR_FIX = { label: "Set it", href: "/settings" };
```

Insert the two guards at the very top of `racePacing`, before the sport
branches, so they apply to every sport:

```ts
if (input.eventDays > 1) return Figure.notApplicable(MULTI_DAY_WHY);
if (sport === "Triathlon") return Figure.notApplicable(TRIATHLON_WHY);
```

Add `ANCHOR_FIX` to both anchor refusals:

```ts
return Figure.missingInput("your FTP", ANCHOR_FIX);
```

```ts
return Figure.missingInput("your threshold pace", ANCHOR_FIX);
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/race/pacing.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Confirm `/settings` is the right href**

Run: `grep -rn "href=\"/settings" src/components src/app --include=*.tsx | head -3`
Expected: at least one hit. If the anchors live behind a tab or a section
anchor, use that exact href instead — a fix link that lands on the wrong page
is worse than none, because it looks like it worked.

- [ ] **Step 6: Commit**

```bash
git add src/lib/race/pacing.ts src/lib/race/pacing.test.ts
git commit -m "feat(race): pacing refuses triathlon and multi-day events, with reasons

Refusing is a first-class result here. Triathlon: bike effort determines
what is left for the run and that link is not modelled. Multi-day: the
stored distance is a total across days, so one sustainable effort over it
describes none of them.

Every refusal carries a reason an athlete reads, and the anchor cases
carry a fix link — a blank would teach them nothing."
```

---

### Task 4: Anchor assembly and the tool

`racePacing` is pure, so something must read the athlete's FTP, threshold pace
and mass out of the database. `volume-inputs.ts:250-285` already does this for
the demand model, but it does it inline inside a much larger function that also
reads stages, overrides and history. This task adds a small focused reader
rather than refactoring that — `src/lib/race/service.ts` already owns "race
things that touch the DB" and says so in its header.

**Files:**

- Modify: `src/lib/race/service.ts`
- Create: `src/lib/tools/get-race-pacing.ts`
- Modify: `src/lib/tools/registry.ts`

**Interfaces:**

- Consumes: `racePacing(input: PacingInput): Figure<PacingTarget>` (Task 1),
  `nextUpcomingRace(userId, now)` (already in `service.ts`),
  `ToolDefinition<T>` and `ToolContext` from `./registry`.
- Produces: `pacingAnchors(userId: string): Promise<{ ftpWatts: number | null; massKg: number | null; thresholdPaceSecPerKm: number | null }>`
  from `service.ts`, which Task 5 also uses; and `getRacePacingTool`.

- [ ] **Step 1: Add the anchor reader to `service.ts`**

```ts
/**
 * The three anchors pacing needs, and nothing else.
 *
 * volume-inputs.ts assembles the same values for the demand model, inline
 * inside a much larger read that also pulls stages, overrides and history
 * derivations. This is deliberately NOT that: pacing needs three numbers, and
 * a focused reader is cheaper to understand than a shared one with six
 * callers' worth of options.
 *
 * Athlete-set values win over synced ones, matching demand.ts's `athleteSet`
 * precedence. Mass carries the same bike-and-kit allowance the demand model
 * uses, so a pacing target and a demand estimate cannot disagree about the
 * rider's weight.
 */
export async function pacingAnchors(userId: string): Promise<{
  ftpWatts: number | null;
  massKg: number | null;
  thresholdPaceSecPerKm: number | null;
}> {
  const prefs = await db.query.bodyPrefs.findFirst({
    where: eq(schema.bodyPrefs.userId, userId),
  });
  // NOTE: the column is `date`, not `day` — it is a Postgres `date` that
  // drizzle types as a string. volume-inputs.ts:46 carries the warning.
  const latest = await db.query.wellnessDaily.findMany({
    where: eq(schema.wellnessDaily.userId, userId),
    orderBy: [desc(schema.wellnessDaily.date)],
    limit: 60,
  });

  const eftp = latest.find((w) => w.eftp != null)?.eftp ?? null;
  const weightKg = latest.find((w) => w.weightKg != null)?.weightKg ?? null;

  return {
    ftpWatts: prefs?.ftpWatts ?? (eftp != null ? Math.round(eftp) : null),
    // Rider weight PLUS the same 8 kg bike-and-kit allowance the demand model
    // applies (volume-inputs.ts:286). Without it a pacing target and a demand
    // estimate would silently disagree about how heavy the rider is, and the
    // pacing number would be the wrong one — riding-time.ts charges mass
    // against every metre of climbing.
    massKg: weightKg != null ? weightKg + 8 : null,
    thresholdPaceSecPerKm: prefs?.thresholdPaceSecPerKm ?? null,
  };
}
```

`service.ts` already imports `desc` and `eq` from drizzle-orm, and `db` /
`schema` from `@/lib/db`, so this needs no new imports.

- [ ] **Step 2: Write the tool**

```ts
// src/lib/tools/get-race-pacing.ts
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./registry";
import { racePacing } from "@/lib/race/pacing";
import { nextUpcomingRace, pacingAnchors } from "@/lib/race/service";

const parameters = z.object({});

async function execute(_args: z.infer<typeof parameters>, ctx: ToolContext) {
  const race = await nextUpcomingRace(ctx.userId, new Date());
  if (!race)
    return { success: true, available: false, reason: "no_upcoming_race" };

  const anchors = await pacingAnchors(ctx.userId);
  const r = racePacing({
    sport: race.sport,
    distanceKm: race.distanceKm,
    elevationM: race.elevationM,
    eventDays: race.eventDays ?? 1,
    ftpWatts: anchors.ftpWatts,
    massKg: anchors.massKg,
    thresholdPaceSecPerKm: anchors.thresholdPaceSecPerKm,
  });

  if (!r.available) {
    return {
      success: true,
      available: false,
      race: { name: race.name, date: race.date, sport: race.sport },
      reason: r.kind,
      // The athlete-facing sentence, not a code. The coach should be able to
      // say WHY there is no number, not just that there isn't one.
      why: r.kind === "not_applicable" ? r.why : null,
      needs: r.kind === "missing_input" ? r.needs : null,
    };
  }

  return {
    success: true,
    available: true,
    race: { name: race.name, date: race.date, sport: race.sport },
    ...r.value,
    confidence: r.confidence,
    why: r.why,
    note:
      "A target for a steady effort, not a segmented plan — this app has no " +
      "course profile, only total distance and total climbing.",
  };
}

export const getRacePacingTool: ToolDefinition<typeof parameters> = {
  name: "get_race_pacing",
  description:
    "How hard to go in the athlete's next race: a target power (bike) or pace " +
    "(run) with a band around it, the confidence, and the assumption behind " +
    "it. Returns a stated reason instead of a number for triathlon, " +
    "multi-day events, or a missing FTP/threshold pace.",
  parameters,
  execute,
};
```

- [ ] **Step 3: Register it**

In `src/lib/tools/registry.ts`, add the import beside the others (~line 87):

```ts
import { getRacePacingTool } from "./get-race-pacing";
```

and the entry in the tool array (~line 147):

```ts
  getRacePacingTool,
```

- [ ] **Step 4: Verify it is registered and typechecks**

Run: `npx tsc --noEmit && npx vitest run tests/ -t "registry"`
Expected: tsc clean. If a registry test asserts a tool count, it will fail with
the old number — update it to the new count, which is the test doing its job.

Run: `grep -c "getRacePacingTool" src/lib/tools/registry.ts`
Expected: `2` (import + array entry).

- [ ] **Step 5: Commit**

```bash
git add src/lib/race/service.ts src/lib/tools/get-race-pacing.ts src/lib/tools/registry.ts
git commit -m "feat(tools): get_race_pacing, serving the coach and MCP

Principle 2: one object, two consumers. The coach must answer 'how hard
should I go Sunday?' from the number the UI shows, not a second one.

Refusals return their athlete-facing sentence rather than a code, so the
coach can say why there is no number instead of only that there isn't."
```

---

### Task 5: The race card

**Files:**

- Modify: `src/lib/race/outlook.ts`
- Modify: `src/app/train/page.tsx`

**Interfaces:**

- Consumes: `racePacing`, `PacingTarget` (Task 1), `pacingAnchors` (Task 4).
- Produces: `RaceCard.pacing: Figure<PacingTarget> | null`.

- [ ] **Step 1: Extend `RaceCard` in `outlook.ts`**

```ts
export interface RaceCard {
  race: {
    name: string;
    date: string;
    priority: string;
    goalNote: string | null;
  } | null;
  daysOut: number | null;
  outlook: RaceOutlook | null;
  /** null only when there is no race at all. */
  pacing: Figure<PacingTarget> | null;
}
```

Add the imports:

```ts
import { racePacing, type PacingTarget } from "./pacing";
import { pacingAnchors } from "./service";
```

In `raceCard`, the early return becomes:

```ts
if (!race) return { race: null, daysOut: null, outlook: null, pacing: null };
```

and after the outlook is assembled, before the final return:

```ts
const anchors = await pacingAnchors(userId);
const pacing = racePacing({
  sport: race.sport,
  distanceKm: race.distanceKm,
  elevationM: race.elevationM,
  eventDays: race.eventDays ?? 1,
  ftpWatts: anchors.ftpWatts,
  massKg: anchors.massKg,
  thresholdPaceSecPerKm: anchors.thresholdPaceSecPerKm,
});
```

Add `pacing` to the returned object.

- [ ] **Step 2: Typecheck to find every consumer**

Run: `npx tsc --noEmit`
Expected: errors anywhere a `RaceCard` is constructed without `pacing` —
including tests. That list IS the set of call sites to update; work through it
until clean. Do **not** make the field optional to silence this: an optional
field would let Today silently render nothing forever.

- [ ] **Step 3: Render it on Train, and only on Train**

In `src/app/train/page.tsx`, inside the existing `{card.race && (...)}` block,
add after the `goalNote` paragraph:

```tsx
{
  card.pacing?.available && (
    <p className="-mt-5 mb-6 px-1 text-label text-ink-muted">
      <span className="font-bold text-ink-secondary">
        {card.pacing.value.sport === "Bike"
          ? `Target ${card.pacing.value.targetWatts} W · hold ${card.pacing.value.lowWatts}–${card.pacing.value.highWatts} W`
          : `Target ${fmtPace(card.pacing.value.targetSecPerKm)} · hold ${fmtPace(card.pacing.value.lowSecPerKm)}–${fmtPace(card.pacing.value.highSecPerKm)}`}
      </span>{" "}
      {card.pacing.why} ({card.pacing.confidence} confidence)
    </p>
  );
}
{
  card.pacing &&
    !card.pacing.available &&
    card.pacing.kind === "not_applicable" && (
      <p className="-mt-5 mb-6 px-1 text-label text-ink-muted">
        {card.pacing.why}
      </p>
    );
}
```

**This goes in `page.tsx`, not inside `RaceChip`.** `RaceChip`
(`src/components/today/race-chip.tsx`) is shared with Today, and the spec puts
the Today chip out of scope — a target, a band and an assumption do not fit a
chip, and cramming them in would drop the assumption first, which is the half
that matters.

Add the formatter beside the other helpers in `page.tsx`:

```tsx
/** Seconds per km as m:ss/km. 285 → "4:45/km". */
function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
```

- [ ] **Step 4: Run the whole suite and the gates**

```bash
npm run lint && npm run typecheck && npx vitest run && npm run format:check && npm run build
```

Expected: all green.

- [ ] **Step 5: See it in a browser**

The `train` surface is captured by `.github/workflows/surfaces.yml`, so the
pull request will photograph it in both themes at both viewports. **Open those
PNGs** — the axe ratchet cannot tell you whether a pacing line reads as
gibberish, and `0 confirmed` on a clean capture is exactly the state
v0.114.0's two worst defects hid behind.

- [ ] **Step 6: Commit**

```bash
git add src/lib/race/outlook.ts src/app/train/page.tsx
git commit -m "feat(train): show race pacing on the race card

Target, band, assumption and confidence, rendered in page.tsx rather
than inside RaceChip — the chip is shared with Today, which is out of
scope, and an assumption is the first thing a chip would drop.

Refusals render their reason. A blank would teach the athlete nothing
about why triathlon has no number."
```

---

## Definition of done

- [ ] `racePacing` returns a target and band for Bike and Run, and a stated
      reason for Triathlon, multi-day events, and missing anchors.
- [ ] The fraction test discriminates: swapping `ftpFractionFor(hours)` for
      `INITIAL_FTP_FRACTION` fails it.
- [ ] `get_race_pacing` is registered and returns the same numbers the UI shows.
- [ ] The Train race card shows target, band, assumption and confidence.
- [ ] Someone has **looked at the captured PNGs**, not just the axe totals.
- [ ] `docs/ROADMAP.md`'s "Race pacing" item is ticked, and `CHANGELOG.md`
      states what an athlete will and will not notice — including that
      triathletes get a stated refusal rather than a number.

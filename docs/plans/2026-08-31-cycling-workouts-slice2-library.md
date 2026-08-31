# Structured cycling workouts — slice 2: the library, first 30

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thirty hand-authored cycling workouts, each carrying its provenance,
and a guard that fails the build if any duration a planned day can actually
take has no workout to answer it.

**Architecture:** One data module, `src/lib/interval/library.ts`, and one guard
test. The guard **derives** the set of reachable durations from the engine's
own exported constants rather than restating them — that table has been written
in prose twice and been wrong twice.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/specs/2026-08-31-structured-cycling-workouts-design.md`

**Branch:** `feat/interval-library` (already carries the two spec corrections
this plan depends on).

## Global Constraints

- **Targets are ALWAYS % of FTP, never watts.** FTP is not an input anywhere in
  this module.
- **Pure module.** `library.ts` is data with type-only imports.
  `purity-guard.test.ts` scans it automatically.
- **Every workout carries a `source`.** Naming its provenance, a confidence
  label, and what would raise it — the `plan-constants.ts` convention. **A
  workout without one does not ship.** These are coaching conventions, and they
  say so; do not dress one up as a citation it does not have.
- **Coverage is capped, not total.** Each purpose is covered to a stated
  ceiling (`recovery` 21–90, `aerobic_base` 21–210, `long` 48–300, `threshold`
  27–120, `vo2max` 32–120). Days above the ceiling keep today's prose and band.
- **Ids are stable and never renumbered** — they are the sort key selection
  depends on.
- Prettier formats this repo; `format:check` is a CI gate. Run
  `npx tsc --noEmit` at the end of every task: the suite strips types without
  checking them, so a green suite is not evidence the branch compiles.

---

### Task 1: The guard, and the reachable set it derives

**Files:**

- Create: `src/lib/interval/library.ts`
- Test: `src/lib/interval/coverage-guard.test.ts`

**Interfaces:**

- Produces: `LIBRARY: readonly LibraryWorkout[]` (empty in this task), and a
  guard asserting every purpose present in it covers its capped range.
- Consumes: `flexSpanSecs` from `./flex`; `RED_ENDURANCE_SCALE`, `AMBER_SCALE`,
  `DAY_REDISTRIBUTE_CAP_PCT`, `RED_RECOVERY_MINS`, `QUALITY_TYPES`, `STEP_DOWN`
  from `@/lib/week-plan/types`; `PURPOSE_BY_TYPE` from `@/lib/training-plan`.

**Why the guard derives rather than restates.** The spec's prose table of "what
each purpose can receive" has been wrong twice: once claiming a red threshold
day scales to 67 minutes (it is _replaced_ by a 30-minute recovery ride, because
`isQuality` keys off `type` and `QUALITY_TYPES` holds `Tempo`), and once
claiming the amber result is still a threshold session (`STEP_DOWN` sends
`Tempo → Endurance` and `withPurpose` re-derives the purpose). A third prose
copy would be a third chance to be wrong. The guard reads the constants.

- [x] **Step 1: Write the failing test**

Create `src/lib/interval/coverage-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LIBRARY } from "./library";
import { flexSpanSecs } from "./flex";
import type { LibraryPurpose } from "./types";
import {
  RED_ENDURANCE_SCALE,
  AMBER_SCALE,
  RED_RECOVERY_MINS,
  QUALITY_TYPES,
  STEP_DOWN,
} from "@/lib/week-plan/types";
import { PURPOSE_BY_TYPE } from "@/lib/training-plan";

/**
 * How far the library is required to cover each purpose. NOT the full
 * reachable range: redistribution makes a 270-minute vo2max day and a
 * 450-minute recovery day technically reachable, and hand-authoring a
 * four-and-a-half-hour VO2max session to satisfy a guard would be the guard
 * driving the coaching. Above the ceiling the day keeps today's prose and
 * band, which the spec calls the honest path rather than a gap.
 *
 * Source: coaching convention, chosen by the athlete/owner. Confidence: Low.
 * What would raise it: nothing available — it is a judgement about what is
 * worth authoring, not a measurable quantity.
 */
const COVER: Record<LibraryPurpose, [number, number]> = {
  recovery: [21, 90],
  aerobic_base: [21, 210],
  long: [48, 300],
  threshold: [27, 120],
  vo2max: [32, 120],
};

/** The type each library purpose is planned as, inverted from PURPOSE_BY_TYPE. */
function typeFor(purpose: LibraryPurpose): string {
  const hit = Object.entries(PURPOSE_BY_TYPE).find(([, p]) => p === purpose);
  if (!hit) throw new Error(`no type maps to purpose ${purpose}`);
  return hit[0];
}

const isQualityPurpose = (p: LibraryPurpose): boolean =>
  (QUALITY_TYPES as readonly string[]).includes(typeFor(p));

describe("the reachable-duration model", () => {
  it("treats exactly the quality purposes as quality", () => {
    // isQuality keys off `type`, not purpose. Getting this backwards is what
    // put a 67-minute threshold day in the spec twice.
    expect(isQualityPurpose("threshold")).toBe(true);
    expect(isQualityPurpose("vo2max")).toBe(true);
    expect(isQualityPurpose("aerobic_base")).toBe(false);
    expect(isQualityPurpose("long")).toBe(false);
    expect(isQualityPurpose("recovery")).toBe(false);
  });

  it("sends every quality purpose one step down, to a purpose the library also answers", () => {
    // Amber changes the purpose as well as the length, so a stepped-down
    // session lands in ANOTHER purpose's coverage range.
    expect(PURPOSE_BY_TYPE[STEP_DOWN[typeFor("vo2max")]]).toBe("threshold");
    expect(PURPOSE_BY_TYPE[STEP_DOWN[typeFor("threshold")]]).toBe(
      "aerobic_base"
    );
  });

  it("scales only non-quality purposes on red, and replaces the rest", () => {
    // A red quality day becomes a RED_RECOVERY_MINS recovery ride; it never
    // becomes a shorter session of its own purpose.
    expect(RED_ENDURANCE_SCALE).toBeLessThan(1);
    expect(AMBER_SCALE).toBeLessThan(1);
    expect(RED_RECOVERY_MINS).toBe(30);
    expect(COVER.recovery[0]).toBeLessThanOrEqual(RED_RECOVERY_MINS);
    expect(COVER.recovery[1]).toBeGreaterThanOrEqual(RED_RECOVERY_MINS);
  });
});

describe("library coverage", () => {
  it("covers every minute of every purpose it answers, with no holes", () => {
    for (const [purpose, [lo, hi]] of Object.entries(COVER) as [
      LibraryPurpose,
      [number, number],
    ][]) {
      const mine = LIBRARY.filter((w) => w.purpose === purpose);
      if (mine.length === 0) continue; // not authored yet; Task 3 closes this
      const covered = new Set<number>();
      for (const w of mine) {
        const span = flexSpanSecs(w);
        expect(span, `${w.id} has no flexable step`).not.toBeNull();
        for (
          let m = Math.ceil(span!.lo / 60);
          m <= Math.floor(span!.hi / 60);
          m++
        ) {
          covered.add(m);
        }
      }
      const gaps: number[] = [];
      for (let m = lo; m <= hi; m++) if (!covered.has(m)) gaps.push(m);
      expect(gaps, `${purpose} has uncovered minutes`).toEqual([]);
    }
  });

  it("gives every workout a stable id and a provenance", () => {
    const ids = LIBRARY.map((w) => w.id);
    expect(new Set(ids).size, "ids must be unique").toBe(ids.length);
    for (const w of LIBRARY) {
      expect(w.source, `${w.id} has no source`).not.toBe("");
      expect(w.source, `${w.id}'s source states no confidence`).toMatch(
        /Confidence:/
      );
      expect(w.why, `${w.id} has no coaching intent`).not.toBe("");
    }
  });

  it("authors whole seconds only", () => {
    // The exact-duration guarantee and both renderers assume integral secs.
    for (const w of LIBRARY) {
      for (const b of w.blocks) {
        for (const s of b.steps) {
          expect(Number.isInteger(s.secs), `${w.id} has fractional secs`).toBe(
            true
          );
        }
      }
    }
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/interval/coverage-guard.test.ts`
Expected: FAIL — cannot resolve `./library`.

- [x] **Step 3: Create the empty library**

Create `src/lib/interval/library.ts`:

```ts
import type { LibraryWorkout } from "./types";

/**
 * The curated cycling library. Hand-authored, and the reason this feature
 * reverses a recorded non-goal — see the spec's "The reversal, recorded".
 *
 * Every workout carries a `source` naming its provenance, a confidence label,
 * and what would raise it. They are coaching conventions and they say so; a
 * shape dressed up as a citation it does not have would break the admission
 * gate the whole reversal rests on.
 *
 * Ids are stable and never renumbered — selection sorts on them.
 */
export const LIBRARY: readonly LibraryWorkout[] = [];
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/lib/interval/coverage-guard.test.ts`
Expected: PASS, 6 tests. Coverage passes vacuously — there is nothing to cover
yet, which Task 3's final assertion closes.

Then `npx tsc --noEmit`: no errors outside `.next/`.

- [x] **Step 5: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/library.ts src/lib/interval/coverage-guard.test.ts
git commit -m "test(interval): the coverage guard, deriving its own reachable set

Reads RED_ENDURANCE_SCALE, AMBER_SCALE, RED_RECOVERY_MINS, QUALITY_TYPES,
STEP_DOWN and PURPOSE_BY_TYPE rather than restating them. The spec's prose
version of this table was wrong twice — a red threshold day is REPLACED by a
30-minute recovery ride rather than scaled, and an amber one changes purpose as
well as length. A third prose copy would be a third chance to be wrong."
```

---

### Task 2: The endurance purposes — 15 workouts

**Files:**

- Modify: `src/lib/interval/library.ts`

**Interfaces:**

- Produces: `recovery`, `aerobic_base` and `long` entries in `LIBRARY`.

**The flex step is the endurance body, not the warmup.** This is what decides
the library's size: a warmup-sized flex step buys ~10 minutes of coverage and
needs 70 workouts to tile the range; sizing the flex step to the span its
purpose must cover needs 17. For these three purposes the longest
`repeat === 1` step is deliberately the endurance block.

**Spans, computed against the shipped `flexSpanSecs` before this plan was
written** — if one disagrees, the transcription is wrong, not the number:

| id                | family        | authored | span (min) |
| ----------------- | ------------- | -------- | ---------- |
| `rec-spin-30`     | easy-spin     | 30       | 20–40      |
| `rec-spin-70`     | easy-spin     | 70       | 40–100     |
| `rec-cadence-30`  | cadence-play  | 30       | 20–40      |
| `rec-cadence-70`  | cadence-play  | 70       | 40–100     |
| `end-short`       | endurance     | 27       | 20–34      |
| `end-mid`         | endurance     | 42       | 27–57      |
| `end-long`        | endurance     | 95       | 58–132     |
| `end-xl`          | endurance     | 230      | 125–335    |
| `end-tempo-mid`   | tempo-touches | 80       | 65–95      |
| `end-tempo-long`  | tempo-touches | 140      | 103–177    |
| `long-short`      | long-steady   | 60       | 40–80      |
| `long-mid`        | long-steady   | 120      | 75–165     |
| `long-xl`         | long-steady   | 240      | 135–345    |
| `long-surges-mid` | long-surges   | 140      | 95–185     |
| `long-surges-xl`  | long-surges   | 235      | 145–325    |

- [x] **Step 1: Add the shared helpers and the fifteen workouts**

Replace the body of `src/lib/interval/library.ts`'s array, keeping its doc
comment, with the helpers and entries below. The helpers keep 30 literals
readable; they are the only abstraction here on purpose.

```ts
import type { LibraryWorkout, Block, Step } from "./types";

const S = (
  secs: number,
  lo: number,
  hi: number,
  x: Partial<Step> = {}
): Step => ({ secs, lo, hi, ...x });
const B = (name: string, repeat: number, steps: Step[]): Block => ({
  name,
  repeat,
  steps,
});
/** Warmup ramps; it is the flex step for quality sessions. */
const WU = (m: number) => B("Warmup", 1, [S(m * 60, 50, 70, { ramp: true })]);
const CD = (m: number) => B("Cooldown", 1, [S(m * 60, 50, 50)]);
/** The endurance body — the flex step for recovery, aerobic_base and long. */
const BODY = (m: number, lo: number, hi: number) =>
  B("Endurance", 1, [S(m * 60, lo, hi)]);

/** `source` in the shape plan-constants.ts uses. */
const conv = (what: string, raise: string): string =>
  `Coaching convention. Confidence: Low — ${what}. What would raise it: ${raise}.`;

const NO_TRIAL =
  "a controlled comparison of these block lengths at this intensity on the same athlete";
```

Then the fifteen entries:

```ts
  // ── recovery ─────────────────────────────────────────────────────────
  {
    id: "rec-spin-30",
    name: "Recovery Spin",
    purpose: "recovery",
    family: "easy-spin",
    why: "Turn the legs over; nothing more.",
    source: conv(
      "no trial fixes a recovery ride's length",
      "any evidence that duration matters below the aerobic threshold"
    ),
    blocks: [WU(5), BODY(20, 45, 55), CD(5)],
  },
  {
    id: "rec-spin-70",
    name: "Long Easy Spin",
    purpose: "recovery",
    family: "easy-spin",
    why: "A longer easy ride when the plan wants volume without stress.",
    source: conv("as rec-spin-30", "the same"),
    blocks: [WU(5), BODY(60, 45, 55), CD(5)],
  },
  {
    id: "rec-cadence-30",
    name: "Recovery with Cadence",
    purpose: "recovery",
    family: "cadence-play",
    why: "Easy watts at high cadence — neuromuscular work without load.",
    source: conv(
      "high-cadence spinning on recovery days is convention, untested against plain easy riding",
      "a trial comparing recovery quality with and without the cadence work"
    ),
    blocks: [WU(5), B("Easy", 1, [S(1200, 45, 55, { rpm: 95 })]), CD(5)],
  },
  {
    id: "rec-cadence-70",
    name: "Long Recovery with Cadence",
    purpose: "recovery",
    family: "cadence-play",
    why: "As the short version, stretched.",
    source: conv("as rec-cadence-30", "the same"),
    blocks: [WU(5), B("Easy", 1, [S(3600, 45, 55, { rpm: 95 })]), CD(5)],
  },

  // ── aerobic_base ─────────────────────────────────────────────────────
  {
    id: "end-short",
    name: "Short Endurance",
    purpose: "aerobic_base",
    family: "endurance",
    why: "Steady aerobic riding — the plan's default session.",
    source: conv(
      "zone-2 riding is near-universal convention; its exact band is not settled",
      "a comparison of 56-75% against a narrower band on the same athlete"
    ),
    blocks: [WU(6), BODY(15, 56, 75), CD(6)],
  },
  {
    id: "end-mid",
    name: "Endurance",
    purpose: "aerobic_base",
    family: "endurance",
    why: "Steady aerobic riding.",
    source: conv("as end-short", "the same"),
    blocks: [WU(6), BODY(30, 56, 75), CD(6)],
  },
  {
    id: "end-long",
    name: "Endurance, Extended",
    purpose: "aerobic_base",
    family: "endurance",
    why: "Steady aerobic riding at length.",
    source: conv("as end-short", "the same"),
    blocks: [WU(10), BODY(75, 56, 75), CD(10)],
  },
  {
    id: "end-xl",
    name: "Endurance, Long",
    purpose: "aerobic_base",
    family: "endurance",
    why: "The upper end of an endurance day.",
    source: conv("as end-short", "the same"),
    blocks: [WU(10), BODY(210, 56, 72), CD(10)],
  },
  {
    id: "end-tempo-mid",
    name: "Endurance with Tempo",
    purpose: "aerobic_base",
    family: "tempo-touches",
    why: "Aerobic volume with two tempo blocks for shape.",
    source: conv(
      "tempo touches inside an endurance ride are convention for time-limited weeks",
      "a comparison against the same minutes ridden flat"
    ),
    blocks: [
      WU(10),
      BODY(30, 56, 72),
      B("Tempo", 2, [S(600, 76, 83), S(300, 55, 55)]),
      CD(10),
    ],
  },
  {
    id: "end-tempo-long",
    name: "Endurance with Tempo, Extended",
    purpose: "aerobic_base",
    family: "tempo-touches",
    why: "As above, longer.",
    source: conv("as end-tempo-mid", "the same"),
    blocks: [
      WU(10),
      BODY(75, 56, 72),
      B("Tempo", 3, [S(600, 76, 83), S(300, 55, 55)]),
      CD(10),
    ],
  },

  // ── long ─────────────────────────────────────────────────────────────
  {
    id: "long-short",
    name: "Short Long Ride",
    purpose: "long",
    family: "long-steady",
    why: "The shortest ride the plan still calls long.",
    source: conv(
      "the two-hour convention for endurance rides is uncited coaching guidance, already recorded at MIN_LONG_BOUND_MINS",
      "a dose-response study on ride duration in trained cyclists"
    ),
    blocks: [WU(10), BODY(40, 56, 72), CD(10)],
  },
  {
    id: "long-mid",
    name: "Long Ride",
    purpose: "long",
    family: "long-steady",
    why: "Steady aerobic hours.",
    source: conv("as long-short", "the same"),
    blocks: [WU(15), BODY(90, 56, 72), CD(15)],
  },
  {
    id: "long-xl",
    name: "Long Ride, Extended",
    purpose: "long",
    family: "long-steady",
    why: "The long end of a long ride.",
    source: conv("as long-short", "the same"),
    blocks: [WU(15), BODY(210, 56, 70), CD(15)],
  },
  {
    id: "long-surges-mid",
    name: "Long Ride with Surges",
    purpose: "long",
    family: "long-surges",
    why: "Steady hours with short efforts late, on already-tired legs.",
    source: conv(
      "late-ride efforts to rehearse fatigue resistance are convention; the placement is not derived",
      "a trial placing the same efforts early against late"
    ),
    blocks: [
      WU(15),
      BODY(90, 56, 72),
      B("Surges", 4, [S(60, 105, 115), S(240, 55, 65)]),
      CD(15),
    ],
  },
  {
    id: "long-surges-xl",
    name: "Long Ride with Surges, Extended",
    purpose: "long",
    family: "long-surges",
    why: "As above, longer.",
    source: conv("as long-surges-mid", "the same"),
    blocks: [
      WU(15),
      BODY(180, 56, 70),
      B("Surges", 5, [S(60, 105, 115), S(240, 55, 65)]),
      CD(15),
    ],
  },
```

- [x] **Step 2: Run the guard**

Run: `npx vitest run src/lib/interval/coverage-guard.test.ts`
Expected: PASS, 6 tests — and now meaningfully: `recovery`, `aerobic_base` and
`long` are each checked for holes across their full capped range.

Then `npx tsc --noEmit` (no errors outside `.next/`) and
`npx vitest run src/lib/interval/` (all module tests still green).

- [x] **Step 3: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/library.ts
git commit -m "feat(interval): the endurance half of the library

Fifteen workouts covering recovery 21-90, aerobic_base 21-210 and long 48-300
with no holes. The flex step is the ENDURANCE BODY, not the warmup: sized that
way these three purposes need 15 workouts where warmup-sized flex would have
needed far more.

Every source is a coaching convention and says so. None claims a citation it
does not have."
```

---

### Task 3: The quality purposes — 15 workouts

**Files:**

- Modify: `src/lib/interval/library.ts`
- Modify: `src/lib/interval/coverage-guard.test.ts`

**The flex step is the warmup here, and it cannot be otherwise.** The main set
is what a threshold or VO₂max session _is_; stretching it makes a different
workout. So each of these covers only ~its warmup's width, and the range is
tiled by varying the main set instead.

**One arithmetic trap, already paid for once:** `FLEX_FLOOR_SECS` is 300, so an
8-minute warmup shrinks to 5 minutes, not 4. `thr-3x4` carries a 4-minute
cooldown rather than 5 for exactly this reason — with 5 its span starts at 28
and the 27-minute day has no answer.

| id                | family           | authored | span (min) |
| ----------------- | ---------------- | -------- | ---------- |
| `thr-3x4`         | threshold-blocks | 30       | 27–34      |
| `thr-3x5`         | threshold-blocks | 40       | 35–45      |
| `ss-3x5`          | sweet-spot       | 40       | 35–45      |
| `thr-3x5-long-wu` | threshold-blocks | 50       | 40–60      |
| `ss-2x12`         | sweet-spot       | 62       | 52–72      |
| `thr-4x8`         | threshold-blocks | 82       | 70–94      |
| `ou-3x12`         | over-under       | 85       | 73–97      |
| `ss-3x20`         | sweet-spot       | 112      | 98–126     |
| `vo2-6x1`         | short-vo2        | 40       | 32–48      |
| `vo2-5x3`         | classic-vo2      | 58       | 48–68      |
| `vo2-30-30`       | short-vo2        | 58       | 48–68      |
| `vo2-5x4`         | classic-vo2      | 74       | 62–86      |
| `vo2-4x5`         | classic-vo2      | 79       | 64–94      |
| `vo2-8x3`         | short-vo2        | 87       | 72–102     |
| `vo2-12x3`        | short-vo2        | 107      | 94–120     |

- [x] **Step 1: Append the fifteen quality workouts**

```ts
  // ── threshold ────────────────────────────────────────────────────────
  {
    id: "thr-3x4",
    name: "Threshold 3×4",
    purpose: "threshold",
    family: "threshold-blocks",
    why: "Three short blocks at threshold — the shortest session that still delivers the stimulus.",
    // The 4-minute cooldown is deliberate: FLEX_FLOOR_SECS stops the warmup
    // shrinking below 5 minutes, so a 5-minute cooldown would start this
    // workout's span at 28 and leave the 27-minute day unanswered.
    source: conv("block length at threshold is convention, not derived", NO_TRIAL),
    blocks: [WU(8), B("Main set", 3, [S(240, 95, 100), S(120, 55, 55)]), CD(4)],
  },
  {
    id: "thr-3x5",
    name: "Threshold 3×5",
    purpose: "threshold",
    family: "threshold-blocks",
    why: "Three blocks at threshold.",
    source: conv("as thr-3x4", NO_TRIAL),
    blocks: [WU(10), B("Main set", 3, [S(300, 95, 100), S(180, 55, 55)]), CD(6)],
  },
  {
    id: "ss-3x5",
    name: "Sweet Spot 3×5",
    purpose: "threshold",
    family: "sweet-spot",
    why: "Three short sweet-spot blocks — less sharp than threshold, easier to repeat.",
    source: conv(
      "the sweet-spot band (88-93%) is widely used and has no settled definition",
      "a comparison of 88-93% against 95-100% for the same total work"
    ),
    blocks: [WU(10), B("Main set", 3, [S(300, 88, 93), S(180, 55, 55)]), CD(6)],
  },
  {
    id: "thr-3x5-long-wu",
    name: "Threshold 3×5, Long Build",
    purpose: "threshold",
    family: "threshold-blocks",
    why: "The same main set behind a longer build.",
    source: conv("as thr-3x4", NO_TRIAL),
    blocks: [WU(20), B("Main set", 3, [S(300, 95, 100), S(180, 55, 55)]), CD(6)],
  },
  {
    id: "ss-2x12",
    name: "Sweet Spot 2×12",
    purpose: "threshold",
    family: "sweet-spot",
    why: "Two longer sweet-spot blocks.",
    source: conv("as ss-3x5", "the same"),
    blocks: [WU(20), B("Main set", 2, [S(720, 88, 93), S(300, 55, 55)]), CD(8)],
  },
  {
    id: "thr-4x8",
    name: "Threshold 4×8",
    purpose: "threshold",
    family: "threshold-blocks",
    why: "Four blocks at threshold — the classic mid-length session.",
    source: conv("as thr-3x4", NO_TRIAL),
    blocks: [WU(25), B("Main set", 4, [S(480, 95, 100), S(240, 55, 55)]), CD(9)],
  },
  {
    id: "ou-3x12",
    name: "Over-Under 3×12",
    purpose: "threshold",
    family: "over-under",
    why: "Alternating either side of threshold — clearing lactate while still working.",
    source: conv(
      "over-unders are convention for threshold tolerance; the 2-minute alternation is arbitrary",
      "a trial comparing alternation periods at matched total work"
    ),
    blocks: [
      WU(25),
      B("Main set", 3, [
        S(120, 105, 105),
        S(120, 90, 90),
        S(120, 105, 105),
        S(120, 90, 90),
        S(120, 105, 105),
        S(120, 90, 90),
        S(300, 55, 55),
      ]),
      CD(9),
    ],
  },
  {
    id: "ss-3x20",
    name: "Sweet Spot 3×20",
    purpose: "threshold",
    family: "sweet-spot",
    why: "Three long sweet-spot blocks — the upper end of a threshold day.",
    source: conv("as ss-3x5", "the same"),
    blocks: [WU(28), B("Main set", 3, [S(1200, 88, 93), S(300, 55, 55)]), CD(9)],
  },

  // ── vo2max ───────────────────────────────────────────────────────────
  {
    id: "vo2-6x1",
    name: "VO₂max 6×1",
    purpose: "vo2max",
    family: "short-vo2",
    why: "Six short, sharp efforts — the shortest VO₂max session worth doing.",
    source: conv(
      "short-interval VO2max work is convention; one minute is one of several lengths in use",
      "a comparison of 1-, 3- and 5-minute intervals at matched total work"
    ),
    blocks: [WU(16), B("Main set", 6, [S(60, 110, 120), S(120, 50, 50)]), CD(6)],
  },
  {
    id: "vo2-5x3",
    name: "VO₂max 5×3",
    purpose: "vo2max",
    family: "classic-vo2",
    why: "Five three-minute efforts with equal recovery.",
    source: conv("3-minute intervals at 106-118% are convention", NO_TRIAL),
    blocks: [WU(20), B("Main set", 5, [S(180, 106, 118), S(180, 50, 50)]), CD(8)],
  },
  {
    id: "vo2-30-30",
    name: "VO₂max 30/30",
    purpose: "vo2max",
    family: "short-vo2",
    why: "Thirty on, thirty off — accumulates time near VO₂max at lower perceived cost.",
    source: conv(
      "30/30s are widely used; the claim that they accumulate more time at VO2max is not tested here",
      "a comparison of measured time-at-VO2max against 4-minute intervals"
    ),
    blocks: [
      WU(20),
      B("Main set", 3, [
        S(30, 115, 125),
        S(30, 50, 50),
        S(30, 115, 125),
        S(30, 50, 50),
        S(30, 115, 125),
        S(30, 50, 50),
        S(30, 115, 125),
        S(30, 50, 50),
        S(30, 115, 125),
        S(30, 50, 50),
        S(300, 50, 50),
      ]),
      CD(8),
    ],
  },
  {
    id: "vo2-5x4",
    name: "VO₂max 5×4",
    purpose: "vo2max",
    family: "classic-vo2",
    why: "Five four-minute efforts — the session most plans mean by VO₂max.",
    source: conv("as vo2-5x3", NO_TRIAL),
    blocks: [WU(25), B("Main set", 5, [S(240, 106, 115), S(240, 50, 50)]), CD(9)],
  },
  {
    id: "vo2-4x5",
    name: "VO₂max 4×5",
    purpose: "vo2max",
    family: "classic-vo2",
    why: "Four five-minute efforts — longer and a little lower than 5×4.",
    source: conv("as vo2-5x3", NO_TRIAL),
    blocks: [WU(30), B("Main set", 4, [S(300, 106, 112), S(300, 50, 50)]), CD(9)],
  },
  {
    id: "vo2-8x3",
    name: "VO₂max 8×3",
    purpose: "vo2max",
    family: "short-vo2",
    why: "Eight three-minute efforts.",
    source: conv("as vo2-6x1", "the same"),
    blocks: [WU(30), B("Main set", 8, [S(180, 108, 116), S(180, 50, 50)]), CD(9)],
  },
  {
    id: "vo2-12x3",
    name: "VO₂max 12×3",
    purpose: "vo2max",
    family: "short-vo2",
    why: "Twelve three-minute efforts — the upper end of a VO₂max day.",
    source: conv("as vo2-6x1", "the same"),
    blocks: [WU(26), B("Main set", 12, [S(180, 108, 116), S(180, 50, 50)]), CD(9)],
  },
```

- [x] **Step 2: Close the vacuous-coverage loophole**

The guard skips a purpose with no workouts, which was right while the library
was being built and is wrong now. Append to the `library coverage` describe in
`src/lib/interval/coverage-guard.test.ts`:

```ts
it("answers every purpose the matcher can be asked for", () => {
  // Until now the coverage test skipped an unauthored purpose. From here a
  // missing purpose is a hole, not a work-in-progress.
  const answered = new Set(LIBRARY.map((w) => w.purpose));
  expect([...answered].sort()).toEqual([
    "aerobic_base",
    "long",
    "recovery",
    "threshold",
    "vo2max",
  ]);
});
```

- [x] **Step 3: Run the guard**

Run: `npx vitest run src/lib/interval/coverage-guard.test.ts`
Expected: PASS, 7 tests, with all five purposes now checked for holes.

Then `npx tsc --noEmit` and `npx vitest run src/lib/interval/`.

- [x] **Step 4: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/library.ts src/lib/interval/coverage-guard.test.ts
git commit -m "feat(interval): the quality half, and the library is complete

Fifteen workouts covering threshold 27-120 and vo2max 32-120 with no holes.
Here the flex step is the WARMUP and cannot be otherwise — the main set is what
the session is — so the range is tiled by varying the main set instead.

thr-3x4 carries a 4-minute cooldown rather than 5 because FLEX_FLOOR_SECS stops
an 8-minute warmup shrinking below 5 minutes; with a 5-minute cooldown its span
starts at 28 and the 27-minute day has no answer.

The guard no longer skips an unauthored purpose."
```

---

### Task 4: Prove the slice

- [x] **Step 1: The library is still pure and still names no wattage**

Run: `npx vitest run src/lib/interval/purity-guard.test.ts`
Expected: PASS, 3 tests. `library.ts` is scanned automatically. If the file
count assertion now fails, raise it — it tracks the module's real size.

- [x] **Step 2: Every workout renders**

The library has never been through the renderers. In a scratch file under your
scratchpad (not under `src/`):

```ts
import { LIBRARY } from "@/lib/interval/library";
import { renderIcu } from "@/lib/interval/render-icu";
import { renderZwo } from "@/lib/interval/render-zwo";
import { renderDescription } from "@/lib/interval/render-description";
import { flexSpanSecs } from "@/lib/interval/flex";
import { resolve } from "@/lib/interval/flex";
import { totalSecs } from "@/lib/interval/duration";

for (const w of LIBRARY) {
  const span = flexSpanSecs(w)!;
  for (const secs of [span.lo, Math.round((span.lo + span.hi) / 2), span.hi]) {
    const blocks = resolve(w, secs / 60);
    if (!blocks)
      throw new Error(`${w.id} refused ${secs / 60} inside its span`);
    if (totalSecs(blocks) !== Math.round((secs / 60) * 60)) {
      throw new Error(`${w.id} inexact at ${secs / 60}`);
    }
    const icu = renderIcu(blocks);
    if (/- \d{3,}m /.test(icu))
      throw new Error(`${w.id} emitted metres: ${icu}`);
    if (renderDescription(blocks) === "")
      throw new Error(`${w.id} has no description`);
    renderZwo({ ...w, blocks });
  }
}
console.log(`${LIBRARY.length} workouts render at three lengths each`);
```

Expected: prints, throws nothing. **This is the first time the renderers meet
real content**, and the `\d{3,}m` check is the metres trap that slice 0 shipped
and slice 1's plan fixed — `end-xl` and `long-xl` are exactly the workouts that
would trip it.

- [x] **Step 3: Read three workouts by eye**

Print `renderIcu` and `renderDescription` for `ou-3x12`, `vo2-30-30` and
`long-surges-xl` — the three whose structures are least like the others — and
read them. The over-under and the 30/30 are the shapes `renderDescription`
summarises by span rather than by naming each step; confirm the sentence is
honest rather than merely non-empty.

- [x] **Step 4: Types, lint, and the full suite**

```bash
npx tsc --noEmit
npx eslint src/lib/interval
npx prettier --check src/lib/interval
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
```

Expected: clean; the suite at its post-slice-1 baseline of **3385 passed, 1
skipped, no expected fail**, plus this slice's 7. Read the shape, not the total.

- [x] **Step 5: Commit the plan's completion**

## What this slice deliberately does not do

- **No matcher change.** Slice 1 shipped it; this only gives it something to
  choose from.
- **No surface.** Nothing renders in the app. Slice 3.
- **No export, no pinning.** Slice 4.
- **No coverage above the ceilings.** Days longer than a purpose's cap keep
  today's prose and band, by decision.
- **Two families is not guaranteed everywhere.** At 30 workouts roughly half
  of the covered minutes have a single family, so `family` rotation is real but
  thin; it fills in as slice 5 authors toward 100+.

## Next

`docs/plans/2026-08-31-cycling-workouts-slice3-surface.md` — the workout name,
profile and targets in the Week open-day block.

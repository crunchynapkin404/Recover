# Structured cycling workouts — slice 1: the matcher

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a planned day and a library, choose the workout that fits it
exactly — or refuse — deterministically, without storing anything.

**Architecture:** Two pure modules beside slice 0's. `flex.ts` answers "which
step absorbs the difference, and how far can it move", and is where the exact-
duration guarantee lives. `match.ts` answers "which of the workouts that fit
does this day get", by a date seed with no history. The library is a
**parameter**, not an import, so this slice is complete and testable before
slice 2 authors a single workout.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/specs/2026-08-31-structured-cycling-workouts-design.md`

**Branch:** cut a fresh one from `main` (slice 0 landed as `#211`).

## Global Constraints

- **Targets are ALWAYS % of FTP, never watts.** No function here takes,
  returns or computes an absolute wattage. **FTP is not an input to the
  matcher at all** — the spec's "a question the matcher does not ask".
- **Pure module.** Type-only imports of app types, no `db`, no `Date.now()`,
  no `Math.random()`. `src/lib/interval/purity-guard.test.ts` scans every
  non-test `.ts` in the directory, so the two new files are covered the moment
  they exist — nothing to register.
- **Nothing is stored.** This slice adds no field, no DDL, no migration.
- **`repeat > 1` blocks are never touched.** The main set is what the workout
  is. Only the flex step moves.
- **Selection reads the date and nothing else.** No clock, no randomness, no
  neighbouring day, no history argument.
- Prettier formats this repo; run `npx prettier --write` on touched files
  before committing, because `format:check` is a CI gate.

---

### Task 1: The flex step, and how far it may move

**Files:**

- Create: `src/lib/interval/flex.ts`
- Test: `src/lib/interval/flex.test.ts`

**Interfaces:**

- Consumes: `Block`, `LibraryWorkout` from `./types`; `totalSecs` from
  `./duration` (both shipped in slice 0).
- Produces: `FLEX_FRACTION`, `FLEX_FLOOR_SECS`,
  `flexRef(blocks: readonly Block[]): { b: number; s: number } | null`, and
  `flexSpanSecs(w: LibraryWorkout): { lo: number; hi: number } | null`.

- [x] **Step 1: Write the failing test**

Create `src/lib/interval/flex.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { flexRef, flexSpanSecs, FLEX_FRACTION, FLEX_FLOOR_SECS } from "./flex";
import type { Block, LibraryWorkout } from "./types";

const W = (secs: number, lo: number, hi: number) => ({ secs, lo, hi });

const wk = (blocks: Block[]): LibraryWorkout => ({
  id: "x",
  name: "x",
  purpose: "threshold",
  family: "f",
  why: "w",
  source: "Invented. Confidence: Low.",
  blocks,
});

const SS: Block[] = [
  { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
  { name: "Main set", repeat: 3, steps: [W(720, 88, 93), W(300, 55, 55)] },
  { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
];

describe("flexRef", () => {
  it("picks the longest step in a repeat-1 block", () => {
    expect(flexRef(SS)).toEqual({ b: 0, s: 0 });
  });

  it("never picks a step inside a repeat, however long", () => {
    // The 720s main-set step is longer than the 600s warmup, but the main set
    // is what the workout IS and must not be stretched.
    const b: Block[] = [
      { name: "Warmup", repeat: 1, steps: [W(600, 50, 65)] },
      { name: "Main set", repeat: 3, steps: [W(720, 88, 93)] },
    ];
    expect(flexRef(b)).toEqual({ b: 0, s: 0 });
  });

  it("breaks ties on the LAST step, putting a cooldown ahead of an equal warmup", () => {
    const b: Block[] = [
      { name: "Warmup", repeat: 1, steps: [W(600, 50, 50)] },
      { name: "Cooldown", repeat: 1, steps: [W(600, 50, 50)] },
    ];
    expect(flexRef(b)).toEqual({ b: 1, s: 0 });
  });

  it("returns null when every block repeats", () => {
    // Nothing to flex: this workout can never be a candidate. Slice 2's guard
    // is where that becomes an authoring error rather than a silent absence.
    expect(
      flexRef([{ name: "Main set", repeat: 5, steps: [W(240, 110, 110)] }])
    ).toBeNull();
  });
});

describe("flexSpanSecs", () => {
  it("spans the fixed remainder plus the flex step's bounds", () => {
    // fixed = 4500 - 900 = 3600. flex 900 -> lo 450, hi 1350.
    expect(flexSpanSecs(wk(SS))).toEqual({ lo: 4050, hi: 4950 });
  });

  it("floors a short flex step at its authored length, not below", () => {
    // A 200s step is already under FLEX_FLOOR_SECS. Math.min keeps it
    // resolvable at 200 rather than making it unmatchable outright.
    const short: Block[] = [
      { name: "Warmup", repeat: 1, steps: [W(200, 50, 50)] },
      { name: "Main set", repeat: 2, steps: [W(600, 90, 90)] },
    ];
    expect(flexSpanSecs(wk(short))).toEqual({ lo: 1400, hi: 1500 });
  });

  it("is null for a workout with nothing to flex", () => {
    expect(
      flexSpanSecs(wk([{ name: "Main", repeat: 5, steps: [W(240, 110, 110)] }]))
    ).toBeNull();
  });

  it("keeps the tolerance constants where the spec put them", () => {
    expect(FLEX_FRACTION).toBe(0.5);
    expect(FLEX_FLOOR_SECS).toBe(300);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/interval/flex.test.ts`
Expected: FAIL — cannot resolve `./flex`.

- [x] **Step 3: Implement**

Create `src/lib/interval/flex.ts`:

```ts
import type { Block, LibraryWorkout } from "./types";
import { totalSecs } from "./duration";

/**
 * How far the one flexible step may move from its authored length, as a
 * fraction of that length. This is the whole tolerance of the matcher: a
 * workout fits a day exactly when its flex step can absorb the difference.
 *
 * Source: Invented — nothing in the literature bounds how far a session's
 * steady portion may stretch before it is a different session.
 * What would raise it: nothing available. It is a judgement about identity,
 * not a measurable quantity.
 * Confidence: Low.
 */
export const FLEX_FRACTION = 0.5;

/**
 * A floor under the flexed step, so a long cooldown never trims to something
 * not worth clipping in for.
 * Source: Invented — a round, convenient number.
 * Confidence: Low.
 */
export const FLEX_FLOOR_SECS = 300;

/**
 * Math.min so a step already shorter than the floor still resolves at its
 * authored length rather than being unmatchable outright.
 */
function flexLo(secs: number): number {
  return Math.min(
    secs,
    Math.max(FLEX_FLOOR_SECS, Math.round(secs * (1 - FLEX_FRACTION)))
  );
}

function flexHi(secs: number): number {
  return Math.round(secs * (1 + FLEX_FRACTION));
}

/**
 * Which step absorbs the difference between a workout's authored length and
 * the day's: the longest step in any `repeat === 1` block, ties won by the
 * LAST, which puts a cooldown ahead of an equal-length warmup.
 *
 * A step inside a repeat is never touched — the main set is what the workout
 * IS. A workout with no `repeat === 1` block therefore has nothing to flex
 * and can never be a candidate.
 *
 * AUTHORING NOTE, because this function decides the library's size: choose
 * the flex step for the span its purpose must cover, not by position. For
 * `recovery`, `aerobic_base` and `long` that is the endurance body, not the
 * warmup — see the spec's table under "Design 3". A warmup-sized flex step
 * everywhere needs 70 workouts to tile the range where 20 would do.
 *
 * Indices, not references: two steps in one workout can be the same object,
 * and slice 0 already shipped a defect from comparing hand-authored steps
 * with `!==`.
 */
export function flexRef(
  blocks: readonly Block[]
): { b: number; s: number } | null {
  let bi = -1;
  let si = -1;
  let best = -1;
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    if (block.repeat !== 1) continue;
    for (let s = 0; s < block.steps.length; s++) {
      if (block.steps[s].secs >= best) {
        best = block.steps[s].secs;
        bi = b;
        si = s;
      }
    }
  }
  return bi === -1 ? null : { b: bi, s: si };
}

/**
 * The continuous range of total durations this workout can be fitted to, in
 * seconds. Slice 2's coverage guard is the union of these across the library
 * — see the spec's "Coverage is continuous, not banded".
 */
export function flexSpanSecs(
  w: LibraryWorkout
): { lo: number; hi: number } | null {
  const ref = flexRef(w.blocks);
  if (!ref) return null;
  const flex = w.blocks[ref.b].steps[ref.s];
  const fixed = totalSecs(w.blocks) - flex.secs;
  return { lo: fixed + flexLo(flex.secs), hi: fixed + flexHi(flex.secs) };
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/lib/interval/flex.test.ts`
Expected: PASS, 8 tests.

- [x] **Step 5: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/flex.ts src/lib/interval/flex.test.ts
git commit -m "feat(interval): the flex step and its bounds

The longest step in any repeat-1 block, ties to the last. A step inside a
repeat is the workout's structure and is never touched. Chosen by index, not
reference — slice 0 shipped a defect from comparing hand-authored steps with
!==. flexSpanSecs is what slice 2's coverage guard will union."
```

---

### Task 2: `resolve` — the exact-duration guarantee

**Files:**

- Modify: `src/lib/interval/flex.ts` (append `resolve`)
- Modify: `src/lib/interval/flex.test.ts` (append a `describe`)

**Interfaces:**

- Consumes: `flexRef`, `flexLo`, `flexHi` (module-private) from Task 1.
- Produces: `resolve(w: LibraryWorkout, durationMins: number): Block[] | null`
  — the workout's blocks with its flex step adjusted so the total is exactly
  `Math.round(durationMins * 60)`, or `null` when that is out of bounds.

- [x] **Step 1: Write the failing test**

Replace the import block at the top of `src/lib/interval/flex.test.ts` with
this. **All four lines — keep the `./types` import.** An earlier draft of this
plan listed only the first three and told you to replace "the two import
lines"; the file has three, and the dropped one is the type import. Following
that literally produced six `Cannot find name 'Block'` errors that the suite
could not see, because vitest transpiles and strips types rather than
type-checking:

```ts
import { describe, it, expect } from "vitest";
import {
  flexRef,
  flexSpanSecs,
  resolve,
  FLEX_FRACTION,
  FLEX_FLOOR_SECS,
} from "./flex";
import { totalSecs } from "./duration";
import type { Block, LibraryWorkout } from "./types";
```

Then append this `describe` to the same file:

```ts
describe("resolve", () => {
  it("hits the requested duration EXACTLY", () => {
    const blocks = resolve(wk(SS), 70);
    expect(blocks).not.toBeNull();
    expect(totalSecs(blocks!)).toBe(4200);
  });

  it("moves only the flex step and leaves the main set alone", () => {
    const blocks = resolve(wk(SS), 70)!;
    expect(blocks[0].steps[0].secs).toBe(600); // warmup absorbed -300
    expect(blocks[1]).toEqual(SS[1]); // main set untouched, same shape
    expect(blocks[2]).toEqual(SS[2]); // cooldown untouched
  });

  it("refuses a length outside the flex step's bounds", () => {
    // SS spans 4050-4950s, i.e. 67.5-82.5 min.
    expect(resolve(wk(SS), 60)).toBeNull();
    expect(resolve(wk(SS), 90)).toBeNull();
  });

  it("refuses a workout with nothing to flex", () => {
    expect(
      resolve(wk([{ name: "Main", repeat: 5, steps: [W(240, 110, 110)] }]), 40)
    ).toBeNull();
  });

  it("hits every whole minute across its own span, exactly", () => {
    // The guarantee the spec states, swept rather than sampled: a rounding
    // slip of one second at some awkward length would not show in an example.
    const span = flexSpanSecs(wk(SS))!;
    let checked = 0;
    for (let secs = span.lo; secs <= span.hi; secs++) {
      if (secs % 60 !== 0) continue;
      const mins = secs / 60;
      const blocks = resolve(wk(SS), mins);
      expect(blocks, `refused ${mins} min inside its own span`).not.toBeNull();
      expect(totalSecs(blocks!)).toBe(Math.round(mins * 60));
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("does not mutate the workout it was given", () => {
    const w = wk(SS);
    const before = JSON.stringify(w);
    resolve(w, 70);
    expect(JSON.stringify(w)).toBe(before);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/interval/flex.test.ts`
Expected: FAIL — `resolve` is not exported.

- [x] **Step 3: Implement**

Append to `src/lib/interval/flex.ts`:

```ts
/**
 * The workout's blocks with its flex step adjusted so the total is EXACTLY
 * `Math.round(durationMins * 60)`, or null when that would push the flex step
 * outside its bounds.
 *
 * This is where "the planned day wins" stops being a slogan. The guarantee is
 * exact and nothing else in the workout moves: the main set the athlete is
 * there for is identical at 68 minutes and at 82.
 *
 * Returns fresh blocks; the library is never mutated, because it is module
 * data shared by every read.
 */
export function resolve(
  w: LibraryWorkout,
  durationMins: number
): Block[] | null {
  const target = Math.round(durationMins * 60);
  const ref = flexRef(w.blocks);
  if (!ref) return null;
  const flex = w.blocks[ref.b].steps[ref.s];
  const wanted = flex.secs + (target - totalSecs(w.blocks));
  if (wanted < flexLo(flex.secs) || wanted > flexHi(flex.secs)) return null;
  return w.blocks.map((b, bi) =>
    bi !== ref.b
      ? b
      : {
          ...b,
          steps: b.steps.map((s, si) =>
            si !== ref.s ? s : { ...s, secs: wanted }
          ),
        }
  );
}
```

- [x] **Step 4: Run the tests, then the type-checker**

Run: `npx vitest run src/lib/interval/flex.test.ts`
Expected: PASS, 14 tests.

Then run `npx tsc --noEmit` and expect no errors outside `.next/`. **A green
suite is not evidence that this branch compiles** — vitest strips types
without checking them, so a broken import passes every test and fails CI's
`npm run typecheck`. Do this at the end of every task, not only at Task 4.

- [x] **Step 5: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/flex.ts src/lib/interval/flex.test.ts
git commit -m "feat(interval): fit a workout to a day's exact length

rendered total === round(durationMins * 60), always, with only the flex step
moving. Swept across every whole minute of a workout's own span rather than
sampled: a one-second rounding slip at an awkward length would not show in an
example. Returns fresh blocks; the library is shared module data and is never
mutated."
```

---

### Task 3: `matchWorkout` — refusal, and the date-seeded pick

**Files:**

- Create: `src/lib/interval/match.ts`
- Test: `src/lib/interval/match.test.ts`

**Interfaces:**

- Consumes: `resolve` from `./flex`; `Block`, `LibraryWorkout` from `./types`;
  `Purpose` from `@/lib/availability/types` (type-only).
- Produces: `MatchResult`, `MatchSession`, and
  `matchWorkout(library: readonly LibraryWorkout[], session: MatchSession, date: string): MatchResult`.

**Two decisions this task locks in, both settled in the spec:**

1. **Variety is spread, not avoidance.** The date seeds the pick; there is no
   history argument, because taking one would reintroduce the neighbouring-day
   dependency the staleness fix removed from the pin. Two days a fortnight
   apart can draw the same workout and nothing promises otherwise.
2. **The pick is family-first** — choose the family, then choose within it.
   Picking ids uniformly would let a family holding five workouts outvote one
   holding a single workout, which is the opposite of what `family` is for.

- [x] **Step 1: Write the failing test**

Create `src/lib/interval/match.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchWorkout } from "./match";
import type { LibraryWorkout } from "./types";

const W = (secs: number, lo: number, hi: number) => ({ secs, lo, hi });

const wk = (
  id: string,
  family: string,
  purpose: LibraryWorkout["purpose"],
  blocks: LibraryWorkout["blocks"]
): LibraryWorkout => ({
  id,
  name: id,
  purpose,
  family,
  why: "w",
  source: "Invented. Confidence: Low.",
  blocks,
});

// Spans, worked out from Task 1's rules:
//   ss-3x12  authored 75 min, flex 900s -> 67.5-82.5 min
//   ss-2x20  authored 74 min, flex 900s -> 66.5-81.5 min
//   thr-4x8  authored 72 min, flex 900s -> 64.5-79.5 min
//   ou-3x12  authored 51 min, flex 900s -> 43.5-58.5 min
//   end-2h   authored 100 min, flex 4800s -> 60-140 min
const STUB: LibraryWorkout[] = [
  wk("ss-3x12", "sweet-spot", "threshold", [
    { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
    { name: "Main set", repeat: 3, steps: [W(720, 88, 93), W(300, 55, 55)] },
    { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
  ]),
  wk("ss-2x20", "sweet-spot", "threshold", [
    { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
    { name: "Main set", repeat: 2, steps: [W(1200, 88, 93), W(300, 55, 55)] },
    { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
  ]),
  wk("thr-4x8", "threshold-blocks", "threshold", [
    { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
    { name: "Main set", repeat: 4, steps: [W(480, 95, 100), W(240, 55, 55)] },
    { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
  ]),
  wk("ou-3x12", "over-under", "threshold", [
    { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
    {
      name: "Main set",
      repeat: 3,
      steps: [W(120, 105, 105), W(120, 90, 90), W(300, 55, 55)],
    },
    { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
  ]),
  wk("end-2h", "endurance", "aerobic_base", [
    { name: "Warmup", repeat: 1, steps: [W(600, 50, 60)] },
    { name: "Endurance", repeat: 1, steps: [W(4800, 60, 75)] },
    { name: "Cooldown", repeat: 1, steps: [W(600, 50, 50)] },
  ]),
  wk("unflexable", "broken", "vo2max", [
    { name: "Main set", repeat: 5, steps: [W(240, 110, 110), W(240, 50, 50)] },
  ]),
];

const BIKE = { sport: "Bike", purpose: "threshold" as const, durationMins: 75 };

describe("matchWorkout refusal", () => {
  it("refuses a session that is not cycling", () => {
    const r = matchWorkout(STUB, { ...BIKE, sport: "Run" }, "2026-09-01");
    expect(r).toEqual({ kind: "refused", reason: "not-cycling" });
  });

  it("refuses a purpose no library workout answers", () => {
    // brick is multi-sport; strength has strength/prescription.ts.
    for (const purpose of ["brick", "strength"] as const) {
      const r = matchWorkout(STUB, { ...BIKE, purpose }, "2026-09-01");
      expect(r).toEqual({ kind: "refused", reason: "not-a-library-purpose" });
    }
  });

  it("refuses when nothing in the library fits the day's length", () => {
    const r = matchWorkout(STUB, { ...BIKE, durationMins: 400 }, "2026-09-01");
    expect(r).toEqual({ kind: "refused", reason: "no-candidate" });
  });

  it("never offers a workout with nothing to flex", () => {
    // `unflexable` is the only vo2max workout in the stub, and it has no
    // repeat-1 block, so every vo2max day refuses.
    const r = matchWorkout(
      STUB,
      { sport: "Bike", purpose: "vo2max", durationMins: 60 },
      "2026-09-01"
    );
    expect(r).toEqual({ kind: "refused", reason: "no-candidate" });
  });
});

describe("matchWorkout selection", () => {
  it("returns blocks fitted to the day, not the authored blocks", () => {
    const r = matchWorkout(STUB, { ...BIKE, durationMins: 70 }, "2026-09-01");
    expect(r.kind).toBe("matched");
    if (r.kind !== "matched") return;
    const total = r.blocks.reduce(
      (t, b) => t + b.repeat * b.steps.reduce((x, s) => x + s.secs, 0),
      0
    );
    expect(total).toBe(4200);
  });

  it("is deterministic: the same day always gets the same workout", () => {
    // Twice is enough: matchWorkout is pure and holds no module state, so
    // repetition adds nothing a second call has not already shown.
    const first = matchWorkout(STUB, BIKE, "2026-09-01");
    for (let i = 0; i < 2; i++) {
      expect(matchWorkout(STUB, BIKE, "2026-09-01")).toEqual(first);
    }
  });

  it("gives different days different workouts", () => {
    const ids = new Set<string>();
    for (let d = 1; d <= 28; d++) {
      const date = `2026-09-${String(d).padStart(2, "0")}`;
      const r = matchWorkout(STUB, BIKE, date);
      if (r.kind === "matched") ids.add(r.workout.id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });

  it("spreads across families rather than across ids", () => {
    // The sweet-spot family holds TWO candidates at 75 min and
    // threshold-blocks holds one, so the two rules differ measurably:
    // family-first gives sweet-spot ~50%, id-uniform would give ~66.7%.
    // ou-3x12 covers 43.5-58.5 and is correctly absent.
    const families = new Map<string, number>();
    const ids = new Map<string, number>();
    for (let d = 0; d < 364; d++) {
      const date = new Date(Date.UTC(2026, 0, 1 + d))
        .toISOString()
        .slice(0, 10);
      const r = matchWorkout(STUB, BIKE, date);
      if (r.kind === "matched") {
        families.set(
          r.workout.family,
          (families.get(r.workout.family) ?? 0) + 1
        );
        ids.set(r.workout.id, (ids.get(r.workout.id) ?? 0) + 1);
      }
    }
    expect([...families.keys()].sort()).toEqual([
      "sweet-spot",
      "threshold-blocks",
    ]);
    // The discriminating assertion: well under the 66.7% id-uniform would give.
    const sweetSpotShare = families.get("sweet-spot")! / 364;
    expect(sweetSpotShare).toBeGreaterThan(0.4);
    expect(sweetSpotShare).toBeLessThan(0.6);
    // And every workout in a multi-workout family must be reachable at all —
    // this is what the seed's missing avalanche used to make impossible.
    expect(ids.get("ss-3x12")).toBeGreaterThan(0);
    expect(ids.get("ss-2x20")).toBeGreaterThan(0);
  });

  it("reaches a workout at a length only it spans", () => {
    const r = matchWorkout(STUB, { ...BIKE, durationMins: 50 }, "2026-09-01");
    expect(r.kind).toBe("matched");
    if (r.kind !== "matched") return;
    expect(r.workout.id).toBe("ou-3x12");
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/interval/match.test.ts`
Expected: FAIL — cannot resolve `./match`.

- [x] **Step 3: Implement**

**Corrected after the final branch review.** The code blocks below match what
actually shipped, not the first draft — most notably `seed`, which needs its
murmur3-style finalizer because FNV-1a's low bit is only a parity of the
input's low bits, and without it one workout in a two-workout family was
picked 0 times in 364 days.

Create `src/lib/interval/match.ts`:

```ts
import type { Purpose } from "@/lib/availability/types";
import type { Block, LibraryWorkout, LibraryPurpose } from "./types";
import { resolve } from "./flex";

/**
 * The session facts the matcher reads — a structural subset of
 * `PlannedWorkout`, so a `ScheduledWorkout` satisfies it with no adapter.
 *
 * `sport` is here even though it is deliberately NOT a field on a
 * LibraryWorkout: the module is cycling-only, so the refusal happens once,
 * here, rather than as a constant repeated across 100+ literals.
 */
export interface MatchSession {
  sport: string;
  purpose: Purpose;
  durationMins: number;
}

/**
 * There is no `synthesized` variant. The spec reserved one and nothing in
 * this slice can return it; an unreachable variant is dead code with a type
 * to maintain. It goes in when something actually synthesizes.
 */
export type MatchResult =
  | { kind: "matched"; workout: LibraryWorkout; blocks: Block[] }
  | {
      kind: "refused";
      reason: "not-cycling" | "not-a-library-purpose" | "no-candidate";
    };

/**
 * Keyed by LibraryPurpose so the two cannot drift: adding a member to
 * LibraryPurpose without adding it here is a compile error, and a key that is
 * not a LibraryPurpose is also a compile error. types.ts asks for exactly this
 * — "never a parallel union ... rather than a silent hole".
 */
const LIBRARY_PURPOSE_KEYS: Record<LibraryPurpose, true> = {
  recovery: true,
  aerobic_base: true,
  long: true,
  threshold: true,
  vo2max: true,
};

const LIBRARY_PURPOSES: ReadonlySet<string> = new Set(
  Object.keys(LIBRARY_PURPOSE_KEYS)
);

/**
 * FNV-1a, with a murmur3-style finalizer mixed in below. Deterministic and
 * dependency-free — but NOT well spread in its own low bits over short
 * inputs like a date string, which is exactly why the finalizer is here; see
 * its comment for what that cost before it was added.
 *
 * A hash rather than a counter because the seed must be the DAY'S OWN DATE and
 * nothing else: that is what makes a re-render, a re-read, and a projection
 * all pick the same workout, with no state to keep in sync.
 */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Avalanche the accumulator before anything takes it modulo a small number.
  // NOT optional and not cargo cult: FNV-1a's prime is odd, so its low bit is
  // only a parity of the input's low bits. That does NOT make
  // seed(`${date}|${family}`) a constant XOR of seed(date) over the whole
  // word — measured over a year the full hash takes 365 distinct values —
  // but the LOW BIT of the two hashes does differ by a constant, which is
  // exactly what degenerates `% 2` to one fixed draw for every date that
  // chose a given family (and already halves `% 4`'s spread to 2 values
  // instead of 4). Measured before this line: one workout of a two-workout
  // family was picked 0 times in 364 days.
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

// An explicit, locale-independent comparator — not the default `.sort()`
// (UTF-16 code-unit order, undocumented as a choice) and not
// `.localeCompare()` (implementation-dependent with no explicit locale,
// which is the one thing a module whose whole contract is determinism cannot
// take on). Returns 0 on equality, unlike a bare `a < b ? -1 : 1`.
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The workout this day gets, or an honest refusal.
 *
 * The library is a PARAMETER, not an import, which is what let this be built
 * and tested before slice 2 authored anything.
 *
 * VARIETY IS SPREAD, NOT AVOIDANCE. There is no history argument. Avoiding
 * what a nearby day picked would require knowing it, and the only ways to know
 * are to accept a `recent` list — reintroducing exactly the neighbouring-day
 * dependency the staleness fix removed from the pin — or to store something.
 * Two days a fortnight apart can draw the same workout; nothing promises
 * otherwise, and the promise is not worth the coupling.
 *
 * The pick is FAMILY-FIRST: choose the family, then choose within it. Picking
 * ids uniformly would let a family holding five workouts outvote one holding a
 * single workout, which is the opposite of what `family` is for.
 *
 * Any candidate inside its flex bound is acceptable by construction — that is
 * what bounding the flex is for — so this does not also rank by how little a
 * workout stretches. Ranking that way would collapse variety outright: the
 * nearest-fitting workout would win every time for a given duration.
 */
export function matchWorkout(
  library: readonly LibraryWorkout[],
  session: MatchSession,
  date: string
): MatchResult {
  if (session.sport !== "Bike") {
    return { kind: "refused", reason: "not-cycling" };
  }
  if (!LIBRARY_PURPOSES.has(session.purpose)) {
    return { kind: "refused", reason: "not-a-library-purpose" };
  }

  const candidates: { workout: LibraryWorkout; blocks: Block[] }[] = [];
  for (const w of library) {
    if (w.purpose !== session.purpose) continue;
    const blocks = resolve(w, session.durationMins);
    if (blocks) candidates.push({ workout: w, blocks });
  }
  if (candidates.length === 0) {
    return { kind: "refused", reason: "no-candidate" };
  }

  const families = [...new Set(candidates.map((c) => c.workout.family))].sort(
    byString
  );
  const family = families[seed(date) % families.length];
  const inFamily = candidates
    .filter((c) => c.workout.family === family)
    .sort((a, b) => byString(a.workout.id, b.workout.id));
  // A second seed with the family mixed in, so the within-family index is not
  // correlated with the family index.
  const chosen = inFamily[seed(`${date}|${family}`) % inFamily.length];
  return { kind: "matched", workout: chosen.workout, blocks: chosen.blocks };
}
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run src/lib/interval/match.test.ts`
Expected: PASS, 9 tests.

- [x] **Step 5: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/match.ts src/lib/interval/match.test.ts
git commit -m "feat(interval): match a planned day to a library workout

The library is a parameter, not an import, so this slice is complete before
slice 2 authors anything.

VARIETY IS SPREAD, NOT AVOIDANCE. There is no history argument: avoiding what
a nearby day picked would need either a \`recent\` list — reintroducing the
neighbouring-day dependency the staleness fix removed from the pin — or stored
state. The date seeds the pick, family-first, because picking ids uniformly
would let a family of five outvote a family of one.

Three refusals, each its own reason: not cycling, a purpose no library workout
answers, and nothing that fits the length."
```

---

### Task 4: prove the slice

- [x] **Step 1: The module is still pure**

Run: `npx vitest run src/lib/interval/purity-guard.test.ts`
Expected: PASS, 3 tests. The guard scans every non-test `.ts` in the
directory, so `flex.ts` and `match.ts` were covered the moment they existed —
there is nothing to register. If it reports fewer than 4 files, the scan broke.

- [x] **Step 2: No FTP reached the matcher**

```bash
for f in src/lib/interval/flex.ts src/lib/interval/match.ts; do
  perl -0777 -pe 's{/\*.*?\*/}{}gs; s{//.*$}{}gm' "$f" | grep -niE "ftp" && echo "  ^ in $f"
done
echo "(no output above means clean)"
```

Expected: no output. **Comment-stripped and scoped to the two files this slice
adds** — an earlier draft grepped the whole module and filtered prose by
enumerating phrasings (`% of FTP`, `% FTP`), which matched a slice-0 doc
comment in `render-zwo.ts` and reported a violation that did not exist. That is
the third prose-matching check to misfire in this feature; `purity-guard.
test.ts` already strips comments and is the pattern to copy. The spec's "a question the
matcher does not ask" — `matchWorkout` takes `(library, session, date)` and a
session is `sport`, `purpose`, `durationMins`. If an FTP appears here, the
refusal-that-refuses-everything defect has come back.

- [x] **Step 3: Types, lint, and the full suite**

```bash
npx tsc --noEmit
npx eslint src/lib/interval
npx prettier --check src/lib/interval
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
```

Expected: clean; the suite at its post-slice-0 baseline of **3361 passed, 1
skipped, no expected fail**, plus this slice's 23 new tests (8 + 6 + 9), for
**3384**. Read the _shape_ of the result, not the total — a guard file that
stops loading takes its own tests with it and the headline number can rise.

- [x] **Step 4: Confirm the guarantee holds outside the tests**

The exact-duration guarantee is the one claim worth checking by hand, because
every later slice assumes it. In a scratch file:

```ts
import { matchWorkout } from "@/lib/interval/match";
import { totalSecs } from "@/lib/interval/duration";
// ...build the STUB from match.test.ts...
for (let mins = 40; mins <= 150; mins++) {
  for (const purpose of ["threshold", "aerobic_base"] as const) {
    const r = matchWorkout(
      STUB,
      { sport: "Bike", purpose, durationMins: mins },
      "2026-09-01"
    );
    if (r.kind === "matched" && totalSecs(r.blocks) !== mins * 60) {
      throw new Error(`${purpose} ${mins}min -> ${totalSecs(r.blocks)}s`);
    }
  }
}
console.log("exact at every length 40-150");
```

Expected: prints, throws nothing.

- [x] **Step 5: Commit the plan's completion**

## What this slice deliberately does not do

- **No library.** Not one workout is authored. Slice 2, whose coverage guard
  unions `flexSpanSecs` across the library.
- **No pinning, no staleness, no storage.** Slice 4.
- **No `synthesized`.** It goes in when something synthesizes.
- **No FTP, indoor or outdoor.** The matcher does not ask.
- **Nothing user-visible.** A reviewer should be able to confirm that by
  observing that no file outside `src/lib/interval/` changed.

## Next

`docs/plans/2026-08-31-cycling-workouts-slice2-library.md` — the first 30
workouts, each with `source` and a confidence label, and the guard asserting
the union of their flex spans covers the continuous integer range per purpose.

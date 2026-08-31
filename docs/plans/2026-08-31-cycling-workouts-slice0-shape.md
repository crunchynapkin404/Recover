# Structured cycling workouts — slice 0: the shape and its renderers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The data shape for a cycling workout, and the three renderers that
turn it into intervals.icu syntax, Zwift `.zwo` XML, and a human-readable
line — so that every representation is derived from one structure and none can
drift from another.

**Architecture:** One pure module, `src/lib/interval/`, holding type-only
imports — the same contract `src/lib/strength/prescription.ts` already keeps.
No database, no clock, no React. Nothing in this slice is user-visible; it
exists so slices 1–5 have something to be built on.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/specs/2026-08-31-structured-cycling-workouts-design.md`

**Branch:** cut a fresh one from `main` (at v0.125.0).

## Global Constraints

- **Targets are ALWAYS % of FTP, never watts.** `lo: 88` means 88% FTP. No
  function in this slice may take, return or compute an absolute wattage;
  resolution against the athlete's own FTP happens later and elsewhere.
- **`blocks` is the single source of truth.** Every renderer derives from it.
  Nothing may be stored in parallel — the spec names the failure mode:
  "`description` should be derived from the steps rather than kept in
  parallel, or the two drift — the same class of defect as v0.122.0's
  duplicated event count."
- **Pure module.** Type-only imports. No `db`, no `Date`, no randomness. This
  is what makes it callable from tests and from the MCP surface, exactly as
  `strengthPrescription` is.
- **Blocks are one level deep.** `repeat: n` with a flat `steps` array. An
  over-under is authored as an unrolled body inside one repeat. No nesting.
- Prettier formats this repo; run `npx prettier --write` on touched files
  before committing, because `format:check` is a CI gate.

---

### Task 1: The shape, and the one derived number

**Files:**

- Create: `src/lib/interval/types.ts`
- Create: `src/lib/interval/duration.ts`
- Test: `src/lib/interval/duration.test.ts`

**Interfaces:**

- Produces: `LibraryPurpose`, `Step`, `Block`, `LibraryWorkout` (types), and
  `totalSecs(blocks: readonly Block[]): number` — the authored length of a
  workout in seconds, counting each repeat.

- [ ] **Step 1: Write the failing test**

Create `src/lib/interval/duration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { totalSecs } from "./duration";
import type { Block } from "./types";

const SS_3X12: Block[] = [
  {
    name: "Warmup",
    repeat: 1,
    steps: [
      { secs: 600, lo: 50, hi: 65, ramp: true },
      { secs: 180, lo: 75, hi: 75 },
      { secs: 120, lo: 55, hi: 55 },
    ],
  },
  {
    name: "Main set",
    repeat: 3,
    steps: [
      { secs: 720, lo: 88, hi: 93, rpm: 90 },
      { secs: 300, lo: 55, hi: 55 },
    ],
  },
  { name: "Cooldown", repeat: 1, steps: [{ secs: 540, lo: 50, hi: 50 }] },
];

describe("totalSecs", () => {
  it("counts every repetition of a repeated block", () => {
    // 900 warmup + 3 x 1020 main + 540 cooldown = 4500s = 75 min exactly.
    expect(totalSecs(SS_3X12)).toBe(4500);
  });

  it("is zero for no blocks", () => {
    expect(totalSecs([])).toBe(0);
  });

  it("treats repeat: 1 as a plain section", () => {
    expect(
      totalSecs([
        { name: "X", repeat: 1, steps: [{ secs: 60, lo: 50, hi: 50 }] },
      ])
    ).toBe(60);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/interval/duration.test.ts`
Expected: FAIL — cannot resolve `./duration`.

- [ ] **Step 3: Write the types**

Create `src/lib/interval/types.ts` exactly as the spec's "Design 2 — The
shape" section gives it, including every doc comment. The comments carry the
reasoning and are not decoration: `LibraryPurpose` explains why it is an
`Extract` of the engine's own `Purpose`, `family` explains why rotation needs
more than an id, and `source` explains that a workout without provenance does
not ship.

- [ ] **Step 4: Write `totalSecs`**

Create `src/lib/interval/duration.ts`:

```ts
import type { Block } from "./types";

/**
 * The authored length of a workout, in seconds, counting every repetition.
 *
 * Authored, not rendered: slice 1's matcher adjusts one flex step to hit a
 * day's exact length, and calls this on the adjusted blocks. Keeping the
 * function ignorant of that distinction is what lets it serve both.
 */
export function totalSecs(blocks: readonly Block[]): number {
  let total = 0;
  for (const b of blocks) {
    let inner = 0;
    for (const s of b.steps) inner += s.secs;
    total += inner * b.repeat;
  }
  return total;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/interval/duration.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/
git commit -m "feat(interval): the cycling workout shape

Types only, plus totalSecs. Targets are %FTP throughout — no function here
takes or returns a wattage; resolution against the athlete's own FTP happens
later and elsewhere. Blocks are one level deep by design."
```

---

### Task 2: `renderIcu` — intervals.icu structured-workout syntax

**Files:**

- Create: `src/lib/interval/render-icu.ts`
- Test: `src/lib/interval/render-icu.test.ts`

**Interfaces:**

- Consumes: `Block`, `Step` from Task 1.
- Produces: `renderIcu(blocks: readonly Block[]): string` — the text that goes
  in the `description` of an intervals.icu WORKOUT event.

**The syntax, quoted from `src/lib/tools/get-workout-syntax.ts` rather than
remembered.** That file ships the spec verbatim over MCP; it is the authority:

- A section is its name on its own line; a repeated section appends the count:
  `Main Set 3x`
- A step is `- <duration> <target>`
- Durations: `10m`, `30s`, `1h30m`, `5m30s`
- Power: `88-94%` for a range, `90%` for a point, both as % of FTP
- Ramp: `- 10m ramp 50%-75%` — note the `%` on **both** numbers, unlike a
  plain range
- Cadence appends: `- 10m 88-94% 90rpm`

- [ ] **Step 1: Write the failing test**

Create `src/lib/interval/render-icu.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderIcu } from "./render-icu";
import type { Block } from "./types";

const SS_3X12: Block[] = [
  {
    name: "Warmup",
    repeat: 1,
    steps: [
      { secs: 600, lo: 50, hi: 65, ramp: true },
      { secs: 180, lo: 75, hi: 75 },
      { secs: 120, lo: 55, hi: 55 },
    ],
  },
  {
    name: "Main set",
    repeat: 3,
    steps: [
      { secs: 720, lo: 88, hi: 93, rpm: 90 },
      { secs: 300, lo: 55, hi: 55 },
    ],
  },
  { name: "Cooldown", repeat: 1, steps: [{ secs: 540, lo: 50, hi: 50 }] },
];

describe("renderIcu", () => {
  it("renders sections, repeats, ranges, ramps and cadence", () => {
    expect(renderIcu(SS_3X12)).toBe(
      [
        "Warmup",
        "- 10m ramp 50%-65%",
        "- 3m 75%",
        "- 2m 55%",
        "",
        "Main set 3x",
        "- 12m 88-93% 90rpm",
        "- 5m 55%",
        "",
        "Cooldown",
        "- 9m 50%",
      ].join("\n")
    );
  });

  it("writes a point target without a range", () => {
    // lo === hi is a point target: "50%", never "50-50%".
    expect(
      renderIcu([
        { name: "X", repeat: 1, steps: [{ secs: 60, lo: 50, hi: 50 }] },
      ])
    ).toContain("- 1m 50%");
  });

  it("writes sub-minute and mixed durations the way the spec defines them", () => {
    const b: Block[] = [
      {
        name: "X",
        repeat: 1,
        steps: [
          { secs: 30, lo: 100, hi: 100 },
          { secs: 90, lo: 60, hi: 60 },
          { secs: 3600, lo: 55, hi: 55 },
        ],
      },
    ];
    const out = renderIcu(b);
    expect(out).toContain("- 30s 100%");
    expect(out).toContain("- 1m30s 60%");
    expect(out).toContain("- 60m 55%");
  });

  it("omits the repeat suffix for a plain section", () => {
    // "Warmup", never "Warmup 1x" — the syntax has no such form.
    // startsWith, not toContain("\nWarmup\n"): Warmup is the FIRST block, so
    // there is no newline before it.
    expect(renderIcu(SS_3X12).startsWith("Warmup\n")).toBe(true);
    expect(renderIcu(SS_3X12)).not.toContain("1x");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/interval/render-icu.test.ts`
Expected: FAIL — cannot resolve `./render-icu`.

- [ ] **Step 3: Implement**

Create `src/lib/interval/render-icu.ts`:

```ts
import type { Block, Step } from "./types";

/**
 * Duration in the syntax's own vocabulary: whole minutes as `10m`, sub-minute
 * as `30s`, anything else as `1m30s`. `get-workout-syntax.ts` lists an `X:YY`
 * form too; one spelling is enough and this is the one its own examples use.
 */
function dur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m${s}s`;
}

function target(step: Step): string {
  const power = step.ramp
    ? `ramp ${step.lo}%-${step.hi}%`
    : step.lo === step.hi
      ? `${step.lo}%`
      : `${step.lo}-${step.hi}%`;
  return step.rpm ? `${power} ${step.rpm}rpm` : power;
}

/**
 * The text intervals.icu parses out of a WORKOUT event's `description`.
 *
 * Syntax authority is src/lib/tools/get-workout-syntax.ts, which ships the
 * specification verbatim over MCP. Two forms are easy to get wrong and are
 * asserted in the tests: a ramp carries `%` on BOTH numbers (`50%-65%`) while
 * a plain range carries it once (`88-93%`), and a section with repeat 1 takes
 * no suffix — there is no `1x` in the syntax.
 */
export function renderIcu(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      const head = b.repeat > 1 ? `${b.name} ${b.repeat}x` : b.name;
      return [
        head,
        ...b.steps.map((s) => `- ${dur(s.secs)} ${target(s)}`),
      ].join("\n");
    })
    .join("\n\n");
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/interval/render-icu.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/
git commit -m "feat(interval): render a workout as intervals.icu syntax

Syntax taken from get-workout-syntax.ts, which ships the spec verbatim over
MCP, rather than from memory. Two forms it is easy to get wrong are asserted:
a ramp carries % on both numbers where a plain range carries it once, and a
repeat-1 section takes no suffix."
```

---

### Task 3: `renderZwo` — Zwift `.zwo` XML

**Files:**

- Create: `src/lib/interval/render-zwo.ts`
- Test: `src/lib/interval/render-zwo.test.ts`

**Interfaces:**

- Consumes: `Block`, `Step`, `LibraryWorkout` from Task 1.
- Produces: `renderZwo(w: LibraryWorkout): string` — a complete `.zwo`
  document. Takes the whole workout, not just blocks, because the format
  carries `name` and `description` in its header.

**Two decisions this task locks in, both worth stating:**

1. **Powers are fractions, not percentages.** `.zwo` writes `Power="0.88"`
   where the library holds `88`. Divide by 100 at the boundary; nothing else
   in the module knows about fractions.
2. **Repeats are unrolled, not written as `IntervalsT`.** Zwift's
   `<IntervalsT>` encodes exactly an on/off pair, so it cannot express a
   repeat whose body is not two steps — and the library's over-unders are
   unrolled bodies of six. Emitting flat `<SteadyState>` elements is always
   correct and needs no special case. It is more verbose in the file and
   identical on the screen.

- [ ] **Step 1: Write the failing test**

Create `src/lib/interval/render-zwo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderZwo } from "./render-zwo";
import type { LibraryWorkout } from "./types";

const W: LibraryWorkout = {
  id: "ss-3x12",
  name: "Sweet Spot 3×12",
  purpose: "threshold",
  family: "sweet-spot",
  why: "Three long blocks just under threshold.",
  source:
    "Coaching convention. Confidence: Low — no trial compares block lengths at this intensity.",
  blocks: [
    {
      name: "Warmup",
      repeat: 1,
      steps: [{ secs: 600, lo: 50, hi: 65, ramp: true }],
    },
    {
      name: "Main set",
      repeat: 3,
      steps: [
        { secs: 720, lo: 88, hi: 93, rpm: 90 },
        { secs: 300, lo: 55, hi: 55 },
      ],
    },
    { name: "Cooldown", repeat: 1, steps: [{ secs: 540, lo: 50, hi: 50 }] },
  ],
};

describe("renderZwo", () => {
  it("writes powers as fractions of FTP, not percentages", () => {
    const xml = renderZwo(W);
    expect(xml).toContain('Power="0.55"');
    expect(xml).toContain('PowerLow="0.5"');
    expect(xml).toContain('PowerHigh="0.65"');
    expect(xml).not.toContain('Power="55"');
  });

  it("unrolls a repeat rather than emitting IntervalsT", () => {
    const xml = renderZwo(W);
    expect(xml).not.toContain("IntervalsT");
    // 3 repeats x 2 steps = 6 elements from the main set, plus warmup and
    // cooldown = 8 total.
    expect((xml.match(/<(SteadyState|Ramp)\b/g) ?? []).length).toBe(8);
  });

  it("carries the name and the coaching intent into the header", () => {
    const xml = renderZwo(W);
    expect(xml).toContain("<name>Sweet Spot 3×12</name>");
    expect(xml).toContain("Three long blocks just under threshold.");
    expect(xml).toContain("<sportType>bike</sportType>");
  });

  it("escapes XML metacharacters in authored text", () => {
    // A workout named with an ampersand must not produce invalid XML.
    const xml = renderZwo({ ...W, name: "Over & Under" });
    expect(xml).toContain("<name>Over &amp; Under</name>");
  });

  it("emits a Ramp element for a ramped step and SteadyState otherwise", () => {
    const xml = renderZwo(W);
    expect(xml).toContain('<Ramp Duration="600"');
    expect(xml).toContain('<SteadyState Duration="720"');
  });

  it("carries cadence when the step has one", () => {
    expect(renderZwo(W)).toContain('Cadence="90"');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/interval/render-zwo.test.ts`
Expected: FAIL — cannot resolve `./render-zwo`.

- [ ] **Step 3: Implement**

Create `src/lib/interval/render-zwo.ts`:

```ts
import type { LibraryWorkout, Step } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `.zwo` writes fractions of FTP where the library holds percentages. */
function frac(pct: number): string {
  return String(pct / 100);
}

function element(s: Step): string {
  const cadence = s.rpm ? ` Cadence="${s.rpm}"` : "";
  if (s.ramp) {
    return `    <Ramp Duration="${s.secs}" PowerLow="${frac(s.lo)}" PowerHigh="${frac(s.hi)}"${cadence}/>`;
  }
  // A non-ramped range still has one steady target; Zwift takes a single
  // Power, so the midpoint is the honest reading of "hold 88-93%".
  const p = s.lo === s.hi ? s.lo : (s.lo + s.hi) / 2;
  return `    <SteadyState Duration="${s.secs}" Power="${frac(p)}"${cadence}/>`;
}

/**
 * A complete Zwift workout document.
 *
 * REPEATS ARE UNROLLED rather than written as <IntervalsT>. That element
 * encodes exactly an on/off pair, so it cannot express a repeat whose body is
 * not two steps — and an over-under is authored as an unrolled body of six.
 * Flat elements are always correct, need no special case, and render
 * identically; the only cost is a longer file.
 */
export function renderZwo(w: LibraryWorkout): string {
  const steps: string[] = [];
  for (const b of w.blocks) {
    for (let i = 0; i < b.repeat; i++) {
      for (const s of b.steps) steps.push(element(s));
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<workout_file>",
    "  <author>Recover</author>",
    `  <name>${esc(w.name)}</name>`,
    `  <description>${esc(w.why)}</description>`,
    "  <sportType>bike</sportType>",
    "  <workout>",
    ...steps,
    "  </workout>",
    "</workout_file>",
  ].join("\n");
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/interval/render-zwo.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/
git commit -m "feat(interval): render a workout as Zwift .zwo

Powers become fractions of FTP at the boundary; nothing else in the module
knows about fractions. Repeats are UNROLLED rather than written as
<IntervalsT>, which encodes exactly an on/off pair and so cannot express an
over-under's six-step body. Flat elements are always correct and render
identically."
```

---

### Task 4: `renderDescription` — the human-readable line

**Files:**

- Create: `src/lib/interval/render-description.ts`
- Test: `src/lib/interval/render-description.test.ts`

**Interfaces:**

- Consumes: `Block` from Task 1.
- Produces: `renderDescription(blocks: readonly Block[]): string`.

**What it replaces.** `PlannedWorkout.description` is hand-written prose today
— `"VO2max intervals: 5×4min at threshold+, 3min recovery"`
(`src/lib/training-plan.ts:979`). For a day carrying a library workout, that
line is **derived** instead. The rule: describe the main set, which is the
block with the highest `repeat`; ties go to the longest.

- [ ] **Step 1: Write the failing test**

Create `src/lib/interval/render-description.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderDescription } from "./render-description";
import type { Block } from "./types";

describe("renderDescription", () => {
  it("describes the main set of a repeated workout", () => {
    const b: Block[] = [
      {
        name: "Warmup",
        repeat: 1,
        steps: [{ secs: 600, lo: 50, hi: 65, ramp: true }],
      },
      {
        name: "Main set",
        repeat: 3,
        steps: [
          { secs: 720, lo: 88, hi: 93 },
          { secs: 300, lo: 55, hi: 55 },
        ],
      },
      { name: "Cooldown", repeat: 1, steps: [{ secs: 540, lo: 50, hi: 50 }] },
    ];
    expect(renderDescription(b)).toBe(
      "3 × 12 min at 88–93% FTP, 5 min recovery"
    );
  });

  it("names a point target without a range", () => {
    const b: Block[] = [
      {
        name: "Main set",
        repeat: 5,
        steps: [
          { secs: 240, lo: 110, hi: 110 },
          { secs: 240, lo: 50, hi: 50 },
        ],
      },
    ];
    expect(renderDescription(b)).toBe("5 × 4 min at 110% FTP, 4 min recovery");
  });

  it("falls back to total time and target when nothing repeats", () => {
    const b: Block[] = [
      { name: "Ride", repeat: 1, steps: [{ secs: 5400, lo: 56, hi: 75 }] },
    ];
    expect(renderDescription(b)).toBe("90 min at 56–75% FTP");
  });

  it("uses an en dash in ranges, matching the app's prose", () => {
    const b: Block[] = [
      { name: "Main set", repeat: 2, steps: [{ secs: 600, lo: 88, hi: 94 }] },
    ];
    expect(renderDescription(b)).toContain("88–94%");
    expect(renderDescription(b)).not.toContain("88-94%");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/interval/render-description.test.ts`
Expected: FAIL — cannot resolve `./render-description`.

- [ ] **Step 3: Implement**

Create `src/lib/interval/render-description.ts`:

```ts
import type { Block, Step } from "./types";
import { totalSecs } from "./duration";

const mins = (secs: number): number => Math.round(secs / 60);

/** En dash, matching the app's prose; the icu syntax uses a hyphen instead. */
function pct(s: Step): string {
  return s.lo === s.hi ? `${s.lo}% FTP` : `${s.lo}–${s.hi}% FTP`;
}

/**
 * The human-readable line for a day carrying a library workout.
 *
 * DERIVED, never stored alongside the steps. `PlannedWorkout.description` is
 * hand-written prose today (training-plan.ts:979); for a library day this
 * replaces it, so the sentence and the structure cannot disagree. The spec
 * names that failure: "the same class of defect as v0.122.0's duplicated
 * event count".
 *
 * The rule is to describe the MAIN SET — the block with the highest repeat,
 * ties to the longest — because that is what the session is. A workout with
 * nothing repeated is described by its total and its target.
 */
export function renderDescription(blocks: readonly Block[]): string {
  const main = [...blocks]
    .filter((b) => b.repeat > 1)
    .sort((a, b) => b.repeat - a.repeat || totalSecs([b]) - totalSecs([a]))[0];

  if (!main) {
    const all = blocks.flatMap((b) => b.steps);
    const work = all.reduce((a, b) => (b.hi > a.hi ? b : a), all[0]);
    return `${mins(totalSecs(blocks))} min at ${pct(work)}`;
  }

  const work = main.steps.reduce(
    (a, b) => (b.hi > a.hi ? b : a),
    main.steps[0]
  );
  const rest = main.steps.filter((s) => s !== work);
  const head = `${main.repeat} × ${mins(work.secs)} min at ${pct(work)}`;
  if (rest.length === 0) return head;
  const recovery = rest.reduce((sum, s) => sum + s.secs, 0);
  return `${head}, ${mins(recovery)} min recovery`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/interval/render-description.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/interval/
git add src/lib/interval/
git commit -m "feat(interval): derive the human-readable line from the steps

PlannedWorkout.description is hand-written prose today; for a library day it
is derived instead, so the sentence and the structure cannot disagree. The
rule is to describe the main set — highest repeat, ties to longest — because
that is what the session is."
```

---

### Task 5: prove the slice

- [ ] **Step 1: The whole module is pure**

```bash
grep -rnE "from \"@/lib/db\"|new Date|Date\.now|Math\.random" src/lib/interval/ || echo "pure"
```

Expected: `pure`. A single hit means this module can no longer be called from
a test or the MCP surface the way `strengthPrescription` is.

- [ ] **Step 2: No wattage anywhere**

```bash
grep -rniE "\bwatt|\bftpWatts|targetLoadKg" src/lib/interval/ || echo "no absolute power"
```

Expected: `no absolute power`. The Global Constraints forbid it: everything
here is % of FTP.

- [ ] **Step 3: Types, lint, and the full suite**

```bash
npx tsc --noEmit
npx eslint src/lib/interval
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
```

Expected: clean; suite at its v0.125.0 baseline of **3337 passed, 1 skipped,
no expected fail**, plus this slice's 17 new tests. Read the _shape_ of the
result, not the total — a guard file that stops loading takes its own tests
with it and the headline number can rise.

- [ ] **Step 4: Round-trip one workout by eye**

Print the three renderings of `ss-3x12` and read them:

```bash
npx tsx -e '
import { renderIcu } from "./src/lib/interval/render-icu";
import { renderZwo } from "./src/lib/interval/render-zwo";
import { renderDescription } from "./src/lib/interval/render-description";
' 2>/dev/null || echo "use a scratch .ts file under /tmp and import from the repo"
```

The intervals.icu text is the one to check hardest: paste it into an
intervals.icu WORKOUT event's description by hand, once, and confirm it parses
into the shape you expect. **Nothing in this slice proves the syntax is
accepted by the service** — the tests assert only that we emit what
`get-workout-syntax.ts` documents.

- [ ] **Step 5: Commit the plan's completion**

## What this slice deliberately does not do

- **No library.** Not one workout is authored here. Slice 2.
- **No matcher, and no flex step.** `totalSecs` reports authored length;
  nothing yet fits a workout to a day. Slice 1.
- **No `renderProfile`.** The in-app SVG belongs with the surface. Slice 3.
- **No `.fit`.** It needs a real binary encoder and intervals.icu already
  reaches Garmin, Wahoo and Zwift on the athlete's behalf.
- **Nothing user-visible.** A reviewer should be able to confirm that by
  observing that no file outside `src/lib/interval/` changed.

## Next

`docs/plans/2026-08-31-cycling-workouts-slice1-matcher.md` — the flex step,
the fit, deterministic selection with family rotation, and refusal.

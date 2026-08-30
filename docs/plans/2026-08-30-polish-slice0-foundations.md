# Visual polish — slice 0: foundations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give motion a token scale and a ratchet guard, and delete the seven
no-op spacing keys that make the spacing scale claim seven steps it does not
have — **without changing a single rendered pixel**.

**Architecture:** Mirrors slice 0 of Phase 2b.4 exactly: tokens and guards
land first, with no call site migrated, so the capture set is the proof of a
no-op. The guard reuses the machinery `tests/type-scale-guard.test.ts` already
established — a patterns module in `src/lib/design/`, a source scan, and a
two-sided `OFFENDER_CEILINGS` ratchet — so the two guards cannot drift apart.

**Tech Stack:** Next.js App Router, Tailwind v4 (`@theme inline` in
`src/app/globals.css`), Vitest, TypeScript.

**Spec:** `docs/specs/2026-08-30-visual-polish-and-motion-design.md`

**Branch:** `feat/finish-the-design-system` (already created; the spec is its
first commit).

## Global Constraints

- **No call site changes in this slice.** No `.tsx` under `src/` may be
  modified except as noted; `globals.css` gains a token block and loses seven
  no-op declarations, and nothing else. If the capture diff is non-empty, the
  slice is wrong.
- **No motion token may take a name Tailwind v4 already defines.** The
  built-in easing keys are `--ease-in`, `--ease-out`, `--ease-in-out` and
  `--ease-linear`. Redefining one silently repoints every existing call site
  using that utility. This is asserted, not merely documented.
- **`--spacing` must stay at Tailwind's default 0.25rem.** It is a multiplier
  on every spacing utility in the app; lowering it to make half-steps look
  integral would halve every padding. Task 5 removes the discrete keys and
  must not add a base.
- **Zero confirmed axe violations is a ratchet, not a milestone** (Phase 2b
  constraint, carried by `docs/ROADMAP.md`). Ceiling stays 0.
- Prettier governs `globals.css` formatting; the token readers match on
  line-anchored declarations, so run `npx prettier --write` on it after
  editing or the guards will not see the tokens.

---

### Task 1: A generic `@theme` token reader

`src/lib/design/tokens.ts` can read the type scale (`readScaleTokens`) but it
is hard-wired to `--text-*` and returns pixel numbers. The motion guard needs
the same "read declarations out of the one `@theme inline` block" logic for a
different prefix, returning raw strings. Copying that logic into the new guard
is exactly the drift `type-scale-patterns.ts`'s own doc comment was created to
stop, so it gets factored into a shared helper first.

**Files:**
- Modify: `src/lib/design/tokens.ts` (add `readPrefixedThemeTokens`)
- Test: `src/lib/design/tokens.test.ts` (create)

**Interfaces:**
- Consumes: `CSS_PATH` (already exported from this module).
- Produces: `readPrefixedThemeTokens(css: string, prefix: string): Record<string, string>` — keys are full token names including the `--`, values are the raw declaration text with surrounding whitespace trimmed. Throws if there is no `@theme inline` block. Returns `{}` for a prefix with no declarations (unlike `readScaleTokens`, which throws — an empty motion scale is a legitimate "before" state that Task 2's test depends on).

- [x] **Step 1: Write the failing test**

Create `src/lib/design/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readPrefixedThemeTokens } from "./tokens";

const CSS = `@theme inline {
  --color-background: var(--background);
  --text-label: 0.75rem; /* 12 */
  --duration-motion: 200ms;
  --ease-settle: cubic-bezier(0.21, 1.02, 0.49, 1);
}

:root {
  --duration-decoy: 999ms;
}
`;

describe("readPrefixedThemeTokens", () => {
  it("reads declarations with the given prefix out of @theme inline", () => {
    expect(readPrefixedThemeTokens(CSS, "--duration-")).toEqual({
      "--duration-motion": "200ms",
    });
  });

  it("keeps the raw value, including commas and parentheses", () => {
    expect(readPrefixedThemeTokens(CSS, "--ease-")).toEqual({
      "--ease-settle": "cubic-bezier(0.21, 1.02, 0.49, 1)",
    });
  });

  it("ignores declarations outside the @theme block", () => {
    // --duration-decoy lives in :root, not @theme, and must not be read:
    // a token that is not in @theme generates no Tailwind utility, so
    // counting it would let a non-token masquerade as part of the scale.
    const found = readPrefixedThemeTokens(CSS, "--duration-");
    expect(found["--duration-decoy"]).toBeUndefined();
  });

  it("returns an empty map for a prefix with no declarations", () => {
    expect(readPrefixedThemeTokens(CSS, "--nothing-")).toEqual({});
  });

  it("throws when there is no @theme inline block", () => {
    expect(() => readPrefixedThemeTokens(":root { --a: 1; }", "--a")).toThrow(
      /@theme inline/
    );
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/design/tokens.test.ts`
Expected: FAIL — `readPrefixedThemeTokens is not a function` (no such export).

- [x] **Step 3: Write minimal implementation**

Add to `src/lib/design/tokens.ts`, directly beneath `readScaleTokens`:

```ts
/**
 * Every `--<prefix>*` declaration inside the ONE `@theme inline { … }` block,
 * as raw strings.
 *
 * `readScaleTokens` above does this for `--text-*` and converts to pixels;
 * this is the same reader for prefixes whose values are not lengths
 * (durations, easing curves). Factored out rather than copied, for the reason
 * `src/lib/design/type-scale-patterns.ts` records: two guards that re-spell
 * the same scan drift apart, and the drift is invisible until something slips
 * through the narrower copy.
 *
 * Returns `{}` — rather than throwing like `readScaleTokens` — for a prefix
 * with no declarations. An absent scale is a legitimate state a guard may
 * want to assert about ("these tokens do not exist yet"); an absent `@theme`
 * block is not, and still throws.
 */
export function readPrefixedThemeTokens(
  css: string,
  prefix: string
): Record<string, string> {
  const block = /^@theme\s+inline\s*\{([\s\S]*?)^\}/m.exec(css);
  if (!block) {
    throw new Error(
      "tokens: no `@theme inline { … }` block in globals.css — the scales " +
        "live there and this reader would find nothing"
    );
  }
  const out: Record<string, string> = {};
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^[ \\t]*(${escaped}[\\w-]*)\\s*:\\s*([^;]+);`, "gm");
  for (const m of block[1].matchAll(re)) out[m[1]] = m[2].trim();
  return out;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/design/tokens.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 5: Commit**

```bash
git add src/lib/design/tokens.ts src/lib/design/tokens.test.ts
git commit -m "refactor(design): a prefix-generic @theme token reader

readScaleTokens is hard-wired to --text-* and returns pixels. The motion
scale needs the same 'read out of the one @theme inline block' logic for a
prefix whose values are not lengths. Factored rather than copied, for the
reason type-scale-patterns.ts records: two guards that re-spell one scan
drift apart invisibly."
```

---

### Task 2: The motion tokens

**Files:**
- Modify: `src/app/globals.css` (inside `@theme inline`, after the spacing scale at line ~110-118)
- Test: `tests/motion-scale-guard.test.ts` (create)

**Interfaces:**
- Consumes: `readPrefixedThemeTokens` from Task 1, `CSS_PATH` from `src/lib/design/tokens`.
- Produces: ten CSS custom properties — `--duration-feedback`, `--duration-motion`, `--duration-transition`, `--duration-reveal`, `--duration-loop`, `--duration-drift`, `--ease-standard`, `--ease-settle`, `--ease-draw`, `--ease-spring`. Later slices reference them as the Tailwind utilities `duration-feedback`, `ease-settle`, and so on.

- [x] **Step 1: Write the failing test**

Create `tests/motion-scale-guard.test.ts`:

```ts
// tests/motion-scale-guard.test.ts — Phase 6.4's guardrail.
//
// The premise, measured 2026-08-30 at d7b1e17: 83 CSS custom properties in
// globals.css, of which ZERO are a duration or an easing, against 11 spellings
// of 10 duration values and 8 distinct easings written by hand. `0.3s` and
// `300ms` both appear, for the same value, in a file that shipped as a design
// system.
//
// Modelled on tests/type-scale-guard.test.ts deliberately — same patterns
// module, same source scan, same two-sided OFFENDER_CEILINGS ratchet — so
// motion cannot become the one scale with no enforcement.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CSS_PATH, readPrefixedThemeTokens } from "../src/lib/design/tokens";

const css = () => readFileSync(CSS_PATH, "utf8");

/**
 * Tailwind v4's OWN easing theme keys. Defining any of these in our @theme
 * block does not add a token — it REPOINTS the built-in utility of the same
 * name at our curve, silently changing every unmigrated `ease-out` in the app
 * from a foundations-only edit. globals.css records the identical trap for
 * --text-*: naming our scale steps `--text-sm` would have overridden every
 * call site still on Tailwind's default type scale.
 */
const TAILWIND_EASE_KEYS = [
  "--ease-in",
  "--ease-out",
  "--ease-in-out",
  "--ease-linear",
];

describe("the motion scale exists", () => {
  it("declares six durations and four easings", () => {
    const durations = readPrefixedThemeTokens(css(), "--duration-");
    const eases = readPrefixedThemeTokens(css(), "--ease-");
    expect(durations).toEqual({
      "--duration-feedback": "120ms",
      "--duration-motion": "200ms",
      "--duration-transition": "320ms",
      "--duration-reveal": "1200ms",
      "--duration-loop": "3s",
      "--duration-drift": "8s",
    });
    expect(eases).toEqual({
      "--ease-standard": "cubic-bezier(0.4, 0, 0.2, 1)",
      "--ease-settle": "cubic-bezier(0.21, 1.02, 0.49, 1)",
      "--ease-draw": "cubic-bezier(0.65, 0, 0.35, 1)",
      "--ease-spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
    });
  });

  it("takes no name Tailwind v4 already defines", () => {
    const ours = Object.keys(readPrefixedThemeTokens(css(), "--ease-"));
    const collisions = ours.filter((t) => TAILWIND_EASE_KEYS.includes(t));
    expect(
      collisions,
      `these token names are Tailwind v4 built-ins — declaring them ` +
        `repoints every existing call site using that utility instead of ` +
        `adding a token. Rename (e.g. --ease-settle, not --ease-out).`
    ).toEqual([]);
  });

  it("writes every duration in one unit, so two spellings cannot mean one value", () => {
    const values = Object.values(readPrefixedThemeTokens(css(), "--duration-"));
    // The bug this pins: globals.css shipped both `0.3s` and `300ms`.
    // Sub-second durations are ms, second-and-over are s, and nothing is
    // written two ways.
    for (const v of values) {
      expect(v, `"${v}" must be an integer ms or whole-second value`).toMatch(
        /^(\d+ms|\d+s)$/
      );
    }
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: FAIL — the first test reports `{}` against the six expected
durations, because no motion tokens exist yet.

- [x] **Step 3: Write minimal implementation**

In `src/app/globals.css`, inside `@theme inline`, immediately after the
`--spacing-12: 3rem;` line and before the block's closing `}`, add:

```css
  /* Motion scale — Phase 6.4. Six durations, four easings, replacing 11
     hand-written duration spellings of 10 values and 8 easings. Semantic
     names, for the same reason the type scale above uses them.

     AND NOT TAILWIND'S OWN KEYS. `--ease-in`, `--ease-out`, `--ease-in-out`
     and `--ease-linear` are Tailwind v4 theme keys: declaring one here does
     not add a token, it repoints every existing `ease-out` in the app at a
     curve it was never designed against — a silent, app-wide motion change
     out of a foundations-only edit. `--ease-settle` costs one word and
     cannot do that. This is the identical trap the type scale's comment
     records for `--text-sm`, and tests/motion-scale-guard.test.ts asserts
     it rather than trusting this paragraph. */
  --duration-feedback: 120ms; /* colour and opacity under the finger */
  --duration-motion: 200ms; /* small transforms, pops, chips */
  --duration-transition: 320ms; /* sheets, panel heights, entrances */
  --duration-reveal: 1200ms; /* one-shot data draws: rings, sparklines */
  --duration-loop: 3s; /* ambient breathe / pulse */
  --duration-drift: 8s; /* the shimmer rotation */

  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-settle: cubic-bezier(0.21, 1.02, 0.49, 1);
  --ease-draw: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```

- [x] **Step 4: Run test to verify it passes**

```bash
npx prettier --write src/app/globals.css
npx vitest run tests/motion-scale-guard.test.ts
```
Expected: PASS, 3 tests.

- [x] **Step 5: Commit**

```bash
git add src/app/globals.css tests/motion-scale-guard.test.ts
git commit -m "feat(design): the motion scale — six durations, four easings

83 custom properties and not one of them a duration or an easing, against 11
hand-written duration spellings of 10 values (0.3s and 300ms both shipped,
for the same value) and 8 easings.

Names avoid Tailwind v4's own --ease-in/-out/-in-out/-linear keys, which
would repoint existing call sites rather than add tokens. Asserted, not
just documented."
```

---

### Task 3: The offender patterns

**Files:**
- Create: `src/lib/design/motion-scale-patterns.ts`
- Test: `src/lib/design/motion-scale-patterns.test.ts` (create)

**Interfaces:**
- Produces: three exported `RegExp`s with the `g` flag — `HANDWRITTEN_MOTION` (CSS duration/easing literals), `TRANSITION_ALL` (the Tailwind utility), `NUMERIC_DURATION` (Tailwind's `duration-<number>` utilities). Task 4 imports all three.

- [x] **Step 1: Write the failing test**

Create `src/lib/design/motion-scale-patterns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  HANDWRITTEN_MOTION,
  TRANSITION_ALL,
  NUMERIC_DURATION,
} from "./motion-scale-patterns";

/** Regexes carry `g`, so lastIndex must not leak between assertions. */
const hits = (re: RegExp, s: string) => s.match(new RegExp(re.source, "g")) ?? [];

describe("HANDWRITTEN_MOTION", () => {
  it("catches both spellings of one duration", () => {
    expect(hits(HANDWRITTEN_MOTION, "animation: sheet-up 300ms ease;")).toContain("300ms");
    expect(hits(HANDWRITTEN_MOTION, "transition: height 0.3s ease-out;")).toContain("0.3s");
  });

  it("catches raw cubic-bezier curves", () => {
    expect(hits(HANDWRITTEN_MOTION, "transition: all 0.7s cubic-bezier(0.21, 1.02, 0.49, 1);"))
      .toContain("cubic-bezier(0.21, 1.02, 0.49, 1)");
  });

  it("does not count a var() reference to a token", () => {
    expect(hits(HANDWRITTEN_MOTION, "animation: sheet-up var(--duration-transition) var(--ease-settle);"))
      .toEqual([]);
  });

  it("does not count the token declarations themselves", () => {
    // The scan excludes the @theme block before applying this pattern, but
    // the pattern must also not fire on a declaration line if it ever sees
    // one — a guard that flags its own scale is a guard nobody can satisfy.
    expect(hits(HANDWRITTEN_MOTION, "  --duration-transition: 320ms;")).toEqual([]);
  });

  it("does not count non-motion numbers that happen to end in s", () => {
    expect(hits(HANDWRITTEN_MOTION, "grid-template-columns: repeat(3, 1fr);")).toEqual([]);
    expect(hits(HANDWRITTEN_MOTION, "flex: 1 1 0%;")).toEqual([]);
  });
});

describe("TRANSITION_ALL", () => {
  it("catches the utility", () => {
    expect(hits(TRANSITION_ALL, 'className="transition-all duration-300"')).toEqual(["transition-all"]);
  });

  it("does not catch the other transition utilities", () => {
    expect(hits(TRANSITION_ALL, 'className="transition-colors transition-opacity"')).toEqual([]);
  });
});

describe("NUMERIC_DURATION", () => {
  it("catches Tailwind's numeric duration utilities", () => {
    expect(hits(NUMERIC_DURATION, 'className="duration-300"')).toEqual(["duration-300"]);
  });

  it("does not catch a token-named duration utility", () => {
    expect(hits(NUMERIC_DURATION, 'className="duration-transition"')).toEqual([]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/design/motion-scale-patterns.test.ts`
Expected: FAIL — cannot resolve `./motion-scale-patterns`.

- [x] **Step 3: Write minimal implementation**

Create `src/lib/design/motion-scale-patterns.ts`:

```ts
/**
 * The motion equivalents of `type-scale-patterns.ts` — one spelling of each
 * scan, imported by every guard that claims to hold the app to the motion
 * scale, for that file's stated reason: guards that re-spell a scan drift
 * apart, and the drift is invisible until something slips through the
 * narrower copy.
 *
 * WHY A SOURCE SCAN IS SOUND FOR THE TWO TAILWIND PATTERNS: Tailwind v4 only
 * compiles classes that appear as literal strings in source, so a class
 * assembled at runtime cannot defeat the scan — it produces no CSS either.
 * That argument is `type-scale-guard.test.ts`'s and it is repeated here
 * because it is the load-bearing one. What it does NOT cover is motion set
 * from an inline `style={{ transition: … }}`; there are none in `src/` as of
 * 2026-08-30 (`grep -rn 'transition\|animation' src --include=*.tsx | grep
 * 'style={{'`), and the ceiling in tests/motion-scale-guard.test.ts is what
 * would notice if the total moved without this pattern seeing why.
 */

/**
 * A duration or easing curve written out rather than referenced as a token.
 *
 * Durations must be preceded by whitespace or `(` and be a real time value,
 * so `repeat(3, 1fr)` and `flex: 1 1 0%` do not match. A `--duration-*` /
 * `--ease-*` declaration line is excluded by the leading lookbehind on `:`,
 * so the scale never counts as its own offender.
 */
export const HANDWRITTEN_MOTION =
  /(?<!--[\w-]{0,40}:\s{0,4})(?<=[\s(])\d+(?:\.\d+)?m?s(?=[\s,;)])|(?<!--[\w-]{0,40}:\s{0,4})cubic-bezier\([^)]*\)/g;

/** `transition-all` — animates every property, including `:active` transforms. */
export const TRANSITION_ALL = /\btransition-all\b/g;

/** Tailwind's numeric duration utilities, which bypass the token scale. */
export const NUMERIC_DURATION = /\bduration-\d+\b/g;
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/design/motion-scale-patterns.test.ts`
Expected: PASS, 9 tests.

If `HANDWRITTEN_MOTION`'s lookbehind proves brittle under Node's regex
engine, the fallback is to keep the pattern simple
(`/(?<=[\s(])\d+(?:\.\d+)?m?s(?=[\s,;)])|cubic-bezier\([^)]*\)/g`) and have
Task 4's scan strip the `@theme inline` block from the CSS before applying
it — the block is already located by `readPrefixedThemeTokens`. Prefer the
fallback over a pattern nobody can read; record which you chose in the commit
message.

- [x] **Step 5: Commit**

```bash
git add src/lib/design/motion-scale-patterns.ts src/lib/design/motion-scale-patterns.test.ts
git commit -m "feat(design): motion-scale offender patterns

One spelling of each scan, imported by every guard, for the reason
type-scale-patterns.ts records: re-spelled scans drift apart invisibly."
```

---

### Task 4: The ratchet

**Files:**
- Modify: `tests/motion-scale-guard.test.ts` (append)

**Interfaces:**
- Consumes: the three patterns from Task 3; `CSS_PATH` from `src/lib/design/tokens`.
- Produces: `OFFENDER_CEILINGS` in this file, which slices 1 and 2 must re-pin.

**Measured starting counts** (working tree at `d7b1e17`, 2026-08-30 — these are
the numbers the ceilings are pinned to, and each was produced by the command
beside it):

| Family | Count | Command |
| --- | --- | --- |
| `globals.css motion literals` | **16** lines | `grep -cE '(^\|[^-a-z])[0-9.]+m?s\b\|cubic-bezier\(' src/app/globals.css` |
| `transition-all` | **17** in 14 files | `grep -rno 'transition-all' src --include=*.tsx \| grep -v test \| wc -l` |
| `numeric duration utilities` | **4** | `grep -rnoE '\bduration-[0-9]+\b' src --include=*.tsx \| grep -v test \| wc -l` |

The four numeric-duration sites, named so a reviewer can check the count
without running anything: `src/app/login/page.tsx:102`,
`src/components/ui/collapsible.tsx:38`,
`src/components/coach/artifact-card.tsx:156`,
`src/components/ui/bottom-sheet.tsx:206`.

- [x] **Step 1: Write the failing test**

Append to `tests/motion-scale-guard.test.ts`, and **extend the existing
`node:fs` import** at the top of the file rather than adding a second one —
`import { readFileSync } from "node:fs"` becomes
`import { readFileSync, readdirSync, statSync } from "node:fs"`, since a
duplicate import from one module trips `no-duplicate-imports`:

```ts
import { join, relative } from "node:path";
import {
  HANDWRITTEN_MOTION,
  TRANSITION_ALL,
  NUMERIC_DURATION,
} from "../src/lib/design/motion-scale-patterns";

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** `file:line` for every match of `pattern` in src/**, excluding tests. */
function srcOffenders(pattern: RegExp): string[] {
  const out: string[] = [];
  for (const file of walk(SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const _ of line.matchAll(new RegExp(pattern.source, "g"))) {
        out.push(`${relative(process.cwd(), file)}:${i + 1}`);
      }
    });
  }
  return out;
}

/** Motion literals in globals.css, with the token block itself excluded. */
function cssMotionOffenders(): string[] {
  const text = css().replace(/^@theme\s+inline\s*\{[\s\S]*?^\}/m, "");
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (line.trim().startsWith("*") || line.trim().startsWith("/*")) return;
    for (const _ of line.matchAll(new RegExp(HANDWRITTEN_MOTION.source, "g"))) {
      out.push(`globals.css:${i + 1}`);
    }
  });
  return out;
}

/* ── THE RATCHET ───────────────────────────────────────────────────────────
 * Same doctrine as tests/type-scale-guard.test.ts, and the same reason: an
 * `it.fails` passes on ANY failure, so it gives no signal at all on the way
 * down — it fires exactly once, at zero, the moment before the goal is met.
 * These ceilings are the missing signal, asserted by real `it()`s.
 *
 * TWO-SIDED ON PURPOSE. A pure upper bound goes stale: a slice that removes
 * ten offenders and leaves the ceiling ten high hands the next implementer
 * ten free ones back. So each ceiling must also stay CLOSE to the real count.
 *
 * RATCHET_SLACK IS 3, NOT the type guard's 25. That guard opened against 300
 * offenders where 25 is under a tenth; these families open at 16, 17 and 4,
 * where a slack of 25 would mean no lower bound at all. The slack must be
 * small relative to the family it governs or the two-sidedness is decorative.
 *
 * TO UPDATE: run the suite, read the actual count out of the failure message,
 * put it here. Lowering is routine. Raising needs a reason in the commit
 * message, and on this strand there is unlikely to be a good one.
 */
const RATCHET_SLACK = 3;
const OFFENDER_CEILINGS: Record<string, number> = {
  // 16 lines, measured 2026-08-30 at d7b1e17, before any migration. Slice 1
  // takes this to 0 by pointing every one at a token.
  "globals.css motion literals": 16,
  // 17 occurrences across 14 files, same commit. Includes ui/button.tsx's
  // base cva string, which animates every property a button has — including
  // the `:active` translate-y, which is why presses read slightly late.
  "transition-all": 17,
  // 4 occurrences, same commit: login/page.tsx:102, ui/collapsible.tsx:38,
  // coach/artifact-card.tsx:156, ui/bottom-sheet.tsx:206.
  "numeric duration utilities": 4,
};

describe("the motion ratchet", () => {
  const counts: Record<string, () => string[]> = {
    "globals.css motion literals": cssMotionOffenders,
    "transition-all": () => srcOffenders(TRANSITION_ALL),
    "numeric duration utilities": () => srcOffenders(NUMERIC_DURATION),
  };

  for (const [name, count] of Object.entries(counts)) {
    it(`${name} does not rise above its pinned ceiling`, () => {
      const actual = count().length;
      const ceiling = OFFENDER_CEILINGS[name];
      expect(
        actual,
        `${name} rose to ${actual}, above the pinned ceiling of ${ceiling}. ` +
          `Use the motion scale — see globals.css's motion block. Nothing on ` +
          `this strand has a good reason to raise a ceiling.`
      ).toBeLessThanOrEqual(ceiling);
    });

    it(`${name}'s ceiling stays close to the real count`, () => {
      const actual = count().length;
      const ceiling = OFFENDER_CEILINGS[name];
      expect(
        ceiling - actual,
        `${name} is down to ${actual} but its ceiling is still ${ceiling} ` +
          `(slack ${RATCHET_SLACK}) — that headroom is free offenders for ` +
          `the next slice. Re-pin OFFENDER_CEILINGS["${name}"] to ${actual}.`
      ).toBeLessThanOrEqual(RATCHET_SLACK);
    });
  }

  it("scanned a plausible source tree", () => {
    // Not a ceiling assertion: this pins that the walk actually found files,
    // so "zero offenders" can never mean "the scan silently measured
    // nothing". type-scale-guard.test.ts:1352 carries the same guard for the
    // same reason.
    expect(walk(SRC).length).toBeGreaterThan(100);
  });
});
```

- [x] **Step 2: Run test to verify it reports the real counts**

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: PASS. If any ceiling assertion fails, **do not adjust the code to
fit the plan** — read the actual count out of the failure message and re-pin
the ceiling to it, then note the corrected number in the commit message. The
numbers above were measured at `d7b1e17`; a concurrent session may have moved
the tree.

- [x] **Step 3: Verify the ratchet actually bites**

Temporarily add `transition-all` to any one `className` in
`src/components/ui/badge.tsx`, then:

Run: `npx vitest run tests/motion-scale-guard.test.ts`
Expected: FAIL — "transition-all rose to 18, above the pinned ceiling of 17".
Then revert the edit with `git checkout src/components/ui/badge.tsx` and
re-run to confirm PASS.

A guard that has never been seen to fail is a guard nobody has tested.

- [x] **Step 4: Commit**

```bash
git add tests/motion-scale-guard.test.ts
git commit -m "test(design): pin the motion ratchet at its measured counts

16 motion literals in globals.css, 17 transition-all, 4 numeric duration
utilities, all measured at d7b1e17. Two-sided like the type-scale ratchet,
with RATCHET_SLACK at 3 rather than 25: that guard opened against 300
offenders where 25 is under a tenth; these families open at 16, 17 and 4,
where 25 would leave no lower bound at all.

Verified the ceiling bites by adding an 18th transition-all and watching it
fail, then reverting."
```

---

### Task 5: Delete the seven no-op spacing keys

`--spacing-1: 0.25rem` … `--spacing-12: 3rem` declare a seven-step scale. Every
one of them restates exactly what Tailwind v4's default `--spacing` base of
`0.25rem` already computes (`N × 0.25rem`), so they generate no distinct
utility and change no rendered pixel — while making the file claim a scale the
app does not run. The app actually uses 11 steps including half-steps: 210
call sites (`py-1.5`×45, `gap-1.5`×37, `py-2.5`×33, `px-3.5`×18, `px-2.5`×16,
and the rest).

**Files:**
- Modify: `src/app/globals.css` (remove lines ~110-118)
- Modify: `tests/motion-scale-guard.test.ts` (append the spacing assertion)

**Interfaces:**
- Consumes: `readPrefixedThemeTokens` from Task 1.
- Produces: nothing new; removes seven declarations.

- [x] **Step 1: Write the failing test**

Append to `tests/motion-scale-guard.test.ts`:

```ts
describe("the spacing scale is the scale the app runs", () => {
  const DEFAULT_BASE_REM = 0.25; // Tailwind v4's own --spacing default

  it("declares no key that merely restates the default base", () => {
    const declared = readPrefixedThemeTokens(css(), "--spacing-");
    const noops: string[] = [];
    for (const [token, value] of Object.entries(declared)) {
      const step = Number(token.replace("--spacing-", ""));
      const rem = /^([\d.]+)rem$/.exec(value);
      if (!Number.isFinite(step) || !rem) continue;
      if (Number(rem[1]) === step * DEFAULT_BASE_REM) noops.push(token);
    }
    expect(
      noops,
      `these declarations compute exactly what Tailwind's default --spacing ` +
        `base already gives, so they add nothing but a false claim that the ` +
        `scale has only these steps. The app runs an 11-step 2px grid: 210 ` +
        `half-step call sites. Delete them.`
    ).toEqual([]);
  });

  it("does not override the spacing base", () => {
    // --spacing multiplies EVERY spacing utility in the app. Lowering it to
    // 0.125rem to make the half-steps look integral would halve every
    // padding on every surface. The half-steps are legitimate on a 4px base;
    // the base does not move.
    expect(readPrefixedThemeTokens(css(), "--spacing")["--spacing"]).toBeUndefined();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/motion-scale-guard.test.ts -t "spacing scale"`
Expected: FAIL — seven no-ops listed: `--spacing-1` … `--spacing-12`.

That failure is the proof the removal is safe. Every listed token computes
what the default already gives, so deleting them cannot move a pixel.

- [x] **Step 3: Remove them**

In `src/app/globals.css`, delete these eight lines (the comment and the seven
declarations) from inside `@theme inline`:

```css
  /* Spacing scale — 4px base. */
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --spacing-3: 0.75rem;
  --spacing-4: 1rem;
  --spacing-6: 1.5rem;
  --spacing-8: 2rem;
  --spacing-12: 3rem;
```

and replace with a comment recording what the scale actually is:

```css
  /* Spacing — Tailwind v4's default 0.25rem base, deliberately NOT
     redeclared. Seven discrete --spacing-N keys used to sit here restating
     exactly what that base computes; they generated no distinct utility and
     claimed a seven-step scale the app has never run. It runs an eleven-step
     2px grid — 210 half-step call sites (py-1.5, gap-1.5, py-2.5, px-3.5,
     px-2.5 and the rest), which are legitimate steps on a 4px base, not
     scatter. Do not lower the base to make them look integral: --spacing
     multiplies every spacing utility in the app, and halving it halves every
     padding on every surface. tests/motion-scale-guard.test.ts asserts both
     halves of this. */
```

- [x] **Step 4: Run the tests**

```bash
npx prettier --write src/app/globals.css
npx vitest run tests/motion-scale-guard.test.ts
```
Expected: PASS, all assertions including the two new ones.

- [x] **Step 5: Commit**

```bash
git add src/app/globals.css tests/motion-scale-guard.test.ts
git commit -m "refactor(design): delete seven no-op spacing keys

--spacing-1 through --spacing-12 each restated exactly what Tailwind v4's
default 0.25rem base already computes, so they generated no distinct utility
and moved no pixel — while claiming a seven-step scale the app has never
run. It runs an eleven-step 2px grid: 210 half-step call sites, which are
legitimate steps on a 4px base, not scatter.

The guard now forbids re-adding a no-op key, and forbids overriding the base
— lowering it to make half-steps look integral would halve every padding in
the app."
```

---

### Task 6: Prove the slice rendered nothing new

The whole premise of a foundations slice is that it changes no pixel. The
tests assert the tokens exist; only a capture proves the app did not move.

**Files:** none modified. This task produces evidence.

- [x] **Step 1: Run the whole suite with a database**

```bash
set -a; . ./.env; set +a
DATABASE_URL="$DATABASE_URL" DATABASE_DRIVER=pg npx vitest run
```
Expected: the v0.124.0 baseline of **3290 passed, 1 expected fail, 1 skipped**,
plus this slice's new tests. The expected fail is
`type-scale-guard.test.ts`'s surviving `it.fails` — it stays failing until
slice 7, and a run where it *passes* is the signal to flip it, not a problem.

- [x] **Step 2: Start the app**

```bash
BETTER_AUTH_URL=http://localhost:3210 npm run dev -- --port 3210
```

If it hangs with no error, read the startup banner for the inferred workspace
root before debugging anything else.

- [x] **Step 3: Seed, then capture**

```bash
SEED_DEMO=1 npx tsx scripts/seed-availability.ts
npx tsx scripts/seed-confirmed-race.ts
SCREENSHOT_BASE_URL=http://localhost:3210 npx tsx scripts/verify-surfaces.ts polish-slice0
```

Seeding is not optional: without `seed-availability.ts` the
`train-availability` surface photographs seven blank tracks, which is how
v0.124.0-rc.1 nearly shipped a picture of nothing.

- [x] **Step 4: Open the pictures — all of them**

Compare against the v0.124.0 capture set. **The expected diff is empty.** A
non-empty diff means a token collided with a Tailwind built-in or the spacing
removal was not the no-op the test claimed, and the slice is wrong.

Open every surface, not the ones you expect to have changed. Four defects
reached a green pipeline on the last release and a human looking at a picture
caught all four.

- [x] **Step 5: Confirm the axe ceiling held**

Expected: **0 confirmed violations.** The ratchet ceiling is 0 and has never
been raised.

- [x] **Step 6: Tick this plan's checkboxes and commit**

The plan document is already on the branch (committed before execution
began), so this commit records the run, not the plan.

```bash
git add docs/plans/2026-08-30-polish-slice0-foundations.md
git commit -m "docs(plan): slice 0 complete — foundations, empty capture diff

Suite green, axe at 0, and the capture set is unchanged from v0.124.0's,
which is the whole claim of a foundations slice: the motion scale and the
spacing correction are in the file and nothing rendered differently.

Record any ceiling re-pinned away from the plan's measured numbers here."
```

---

## What this slice deliberately does not do

Named so they are not mistaken for oversights, and so the next slice's plan
knows what it inherits:

- **No call site uses the new tokens yet.** Slice 1 migrates all 16 CSS motion
  literals, the 17 `transition-all` and the 4 numeric duration utilities, and
  re-pins all three ceilings.
- **`transition-all` on `ui/button.tsx` still animates the `:active`
  transform.** It is one of the 17 and it is slice 1's.
- **Reduced motion is still the `*` sledgehammer**, and the six `loading.tsx`
  files still carry no busy semantics. Slice 2.
- **`--pad-card` / `--pad-row` / `--gap-stack` are not introduced here.** The
  spec assigns them to the density work; this slice only removes the false
  claim about the spacing scale.
- **`design-system.md` still says the app has one theme.** It has had two
  since v0.111.0. Slice 7 rewrites the document prescriptive, as 2b.4's slice
  9 intended.

## Next

`docs/plans/2026-08-30-polish-slice1-motion-migration.md`, written when this
slice's captures are clean — the same per-slice rhythm 2b.4 used
(`docs/plans/2026-08-1[23]-v099-slice*.md`), so a defect found after deploy
costs one `git revert` rather than the release.


---

## Outcome — run 2026-08-30, all six tasks complete

**Suite:** 3316 passed, 1 expected fail, 1 skipped (3318). Up 26 from the
v0.124.0 baseline of 3290; the expected fail is `type-scale-guard.test.ts`'s
surviving `it.fails`, which stays failing until slice 7. `tsc --noEmit` clean.

**Captures:** 100 PNGs over ~40 surfaces in both themes and both viewports,
`.screenshots/polish-slice0/`. **Confirmed axe violations: 0** — the ratchet
ceiling held and was not raised.

22 surfaces recorded capture errors, all fixture gaps in the dev database and
none a rendering defect: `first-run-*` (16) needs a dataless account and this
one has data; `train-plan-preview` (4) needs a draft plan; `activity-detail`
and `debrief-sheet` (6, overlapping) need an activity to exist. The run still
exited 0.

**The no-op claim, proven at the compiler rather than by eye.** No full
v0.124.0 capture set exists on disk to diff against — every earlier set is a
4-image `--only=train` run — so a picture diff was not available. A stronger
check was: only `globals.css` can reach the screen (the other new files are
imported by tests alone), so the entire stylesheet was compiled through
`@tailwindcss/postcss` at `b331578` and at HEAD and the two outputs diffed in
full.

- **120 changed declarations, all computing identically, zero mismatches.**
  Every one is a spacing utility moving from an inlined literal to
  `calc(var(--spacing) * n)` — `padding: 1rem` → `calc(var(--spacing) * 4)`
  — and Tailwind emits its own `--spacing: 0.25rem`, so each resolves to
  exactly the value it had.
- **One token-block hunk:** 7 spacing keys out, 10 motion tokens in. Custom
  properties only; no rule references them yet.
- **One new dead rule:** `.ease-settle` (4 lines), generated because the token
  name appears in the new source *text* — Tailwind scans comments and test
  files as class candidates. No element carries that class, so it cannot
  render; slice 1 makes it real. Worth recording as the same family as
  `viewport-zoom-guard.test.ts`'s bare-word matching: writing a utility name
  in prose has effects in this repo.
- **`.ease-out` in the output is still bound to Tailwind's own `--ease-out`.**
  That is the naming decision working, visible in the compiled artefact rather
  than argued from the spec.

Nothing else in 136,689 bytes of compiled CSS differs. A stylesheet whose only
changes are unused custom properties, arithmetically identical spacing, and a
rule no element carries cannot render differently.

**Two errors the ratchet caught in this plan, on its first run** — recorded
because both were mine and both would have been pinned in as if real:

1. The CSS ceiling was predicted at 16 from `grep -c`, which counts matching
   **lines**. The guard counts occurrences: 16 lines carry 25 literals,
   because a `transition:` shorthand spells a duration and a curve on one
   line. Re-pinned to 25; all 25 read back individually to confirm none is
   prose.
2. `transition-all` came out at 19, not 17, because the scan was counting the
   **patterns module itself** — `/\btransition-all\b/` necessarily contains
   the literal it hunts for, and so does its doc comment.
   `type-scale-patterns.ts` never hit this because its patterns are shapes
   that spell no literal. The module is now excluded from its own scan.

**Ceilings as they stand for slice 1 to drive down:** `globals.css motion
literals` 25, `transition-all` 17, `numeric duration utilities` 4.

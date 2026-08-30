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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { CSS_PATH, readPrefixedThemeTokens } from "../src/lib/design/tokens";
import {
  HANDWRITTEN_MOTION,
  TRANSITION_ALL,
  NUMERIC_DURATION,
} from "../src/lib/design/motion-scale-patterns";

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

const SRC = join(process.cwd(), "src");

/**
 * THE PATTERNS MODULE IS EXCLUDED FROM ITS OWN SCAN, and that is not a
 * convenience — without it this guard counts itself. `TRANSITION_ALL` is
 * `/\\btransition-all\\b/`, so the regex necessarily contains the literal it
 * hunts for, and so does the doc comment above it: two phantom offenders that
 * would have been permanently pinned into the ceiling as if they were real
 * call sites.
 *
 * `type-scale-patterns.ts` never hit this because its patterns are shapes
 * (`text-\\[…(px|rem|em)\\]`) that never spell a literal — and its own comment
 * records refusing to write examples "since this file lives inside the tree
 * the patterns themselves scan". A literal-bearing pattern cannot dodge it
 * that way, so the exclusion is named here instead.
 *
 * This is the same family of trap as tests/viewport-zoom-guard.test.ts
 * matching BARE WORDS, where naming `touch-none` in a comment fails the
 * guard.
 */
const SELF = join(SRC, "lib/design/motion-scale-patterns.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full) && full !== SELF)
      out.push(full);
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
  // 0 — slice 1 migrated every literal onto the motion scale. Was 25 at
  // d7b1e17; the two-sided ratchet now pins it here, so a re-introduced
  // literal fails the suite immediately.
  //
  // The plan predicted 16 and the ratchet caught it on its first run. 16 was
  // `grep -c`, which counts matching LINES; this counts occurrences, and 16
  // lines carry 25 literals because a `transition:` shorthand spells a
  // duration and a curve on one line. Occurrences is the right unit — each is
  // its own migration — and all 25 were read back individually to confirm
  // none is prose caught by the scan.
  "globals.css motion literals": 0,
  // Includes ui/button.tsx's base cva string, which animates every property a
  // button has — including the `:active` translate-y, which is why presses
  // read slightly late.
  "transition-all": 17,
  // login/page.tsx:102, ui/collapsible.tsx:38, coach/artifact-card.tsx:156,
  // ui/bottom-sheet.tsx:206.
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
    expect(
      readPrefixedThemeTokens(css(), "--spacing")["--spacing"]
    ).toBeUndefined();
  });
});

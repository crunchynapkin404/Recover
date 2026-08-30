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
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
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
    const durations = readPrefixedThemeTokens(css(), "--transition-duration-");
    const eases = readPrefixedThemeTokens(css(), "--ease-");
    expect(durations).toEqual({
      "--transition-duration-feedback": "120ms",
      "--transition-duration-motion": "200ms",
      "--transition-duration-panel": "320ms",
      "--transition-duration-reveal": "1200ms",
      "--transition-duration-loop": "3s",
      "--transition-duration-drift": "8s",
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

  it("uses a namespace Tailwind actually generates utilities from", async () => {
    // THE BUG THIS PINS, and it shipped in slice 0: the scale was declared as
    // `--duration-*`, which is a plain custom property Tailwind v4 generates
    // NOTHING from. `duration-panel` was an inert class — present in markup,
    // silently doing nothing, and no test noticed because the tokens existed
    // and the class name looked right. `--transition-duration-*` is the real
    // namespace. `--ease-*` was correct already, which is why .ease-settle
    // compiled while its duration sibling did not.
    //
    // Compiling is the only honest check here: a token's EXISTENCE says
    // nothing about whether a utility exists, and that gap is exactly what
    // let the wrong namespace through.
    const postcss = (await import("postcss")).default;
    const tw = (await import("@tailwindcss/postcss")).default;
    const out = await postcss([tw()]).process(css(), { from: CSS_PATH });
    for (const cls of ["duration-panel", "duration-motion", "ease-settle"]) {
      expect(
        new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`).test(out.css),
        `.${cls} generates no CSS. The token exists but its namespace is one ` +
          `Tailwind does not build utilities from, so every call site using ` +
          `this class is silently doing nothing. Durations belong under ` +
          `--transition-duration-*, easings under --ease-*.`
      ).toBe(true);
    }
  });

  it("writes every duration in one unit, so two spellings cannot mean one value", () => {
    const values = Object.values(readPrefixedThemeTokens(css(), "--transition-duration-"));
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

/**
 * Motion literals in globals.css, with two regions excluded.
 *
 * The `@theme inline` block is the scale itself — a guard that flags its own
 * tokens is one nobody can satisfy.
 *
 * The `prefers-reduced-motion` block is excluded because its `1ms` values are
 * NOT scale steps and must never become tokens. They mean "effectively zero",
 * an accessibility escape hatch deliberately off the scale; giving one a
 * semantic name would imply it is a duration an athlete experiences. (They
 * are 1ms rather than 0 for a reason the rule's own comment gives: `none`
 * cancels, so `transitionend` never fires.)
 */
function cssMotionOffenders(): string[] {
  const text = css()
    .replace(/^@theme\s+inline\s*\{[\s\S]*?^\}/m, "")
    .replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/, "")
    // COMMENTS ARE STRIPPED WHOLESALE, not skipped line-by-line. The
    // line-by-line version this replaces only skipped lines *starting* with
    // `*` or `/*`, so the continuation lines of a block comment — which
    // Prettier formats as plain prose — were scanned as declarations. Writing
    // "a 1ms duration" in a sentence explaining the reduced-motion rule
    // failed this guard. That is the same bare-words trap
    // tests/viewport-zoom-guard.test.ts carries, and a guard prose can trip
    // is one people work around instead of satisfying.
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
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
  // 0 — slice 1 replaced every one with the properties that actually change
  // at that call site. Was 17, including ui/button.tsx's base cva string,
  // which animated every property a button has — the `:active` translate-y
  // included, which is why presses read slightly late.
  "transition-all": 0,
  // 0 — slice 1 moved all four onto token-named utilities. Was 4 at d7b1e17:
  // login/page.tsx:102, ui/collapsible.tsx:38, coach/artifact-card.tsx:156,
  // ui/bottom-sheet.tsx:206.
  "numeric duration utilities": 0,
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


/** Every `loading.tsx` under src/app, as repo-relative paths. */
function loadingFiles(
  dir = join(process.cwd(), "src/app"),
  out: string[] = []
): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) loadingFiles(full, out);
    else if (entry === "loading.tsx") out.push(relative(process.cwd(), full));
  }
  return out;
}

describe("a route that waits says so", () => {
  it("every loading.tsx announces itself", () => {
    // The defect this pins: all six loading.tsx files carried skeletons and
    // NOTHING else — no role, no live region, no text. A screen-reader user
    // got silence, and because the reduced-motion rule kills animation
    // outright, a reduced-motion user got a static grey page. Motion was the
    // only carrier of "this is loading", and two audiences cannot perceive it.
    const silent = loadingFiles().filter(
      (f) => !readFileSync(f, "utf8").includes("LoadingScreen")
    );
    expect(
      silent,
      `these loading states carry no status semantics — wrap their skeletons ` +
        `in <LoadingScreen label="…"> so the wait is announced rather than ` +
        `only animated.`
    ).toEqual([]);
  });

  it("Skeleton is decorative, not announced", () => {
    const src = readFileSync("src/components/ui/skeleton.tsx", "utf8");
    expect(
      src.includes("aria-hidden"),
      "Skeleton must be aria-hidden: it is decoration, and the LoadingScreen " +
        "region around it is what speaks. Without this a screen reader walks " +
        "a pile of empty divs."
    ).toBe(true);
  });
});

describe("routes that await", () => {
  /** Every page.tsx under src/app, repo-relative. */
  function pageFiles(
    dir = join(process.cwd(), "src/app"),
    out: string[] = []
  ): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) pageFiles(full, out);
      else if (entry === "page.tsx") out.push(relative(process.cwd(), full));
    }
    return out;
  }

  /**
   * A page is an offender when it can make the athlete wait and says nothing
   * while it does. "Can wait" is `await` in a server component: a "use client"
   * page renders instantly, and a page whose whole body is a redirect() never
   * paints.
   */
  function awaitingWithoutLoading(): string[] {
    return pageFiles().filter((f) => {
      const src = readFileSync(f, "utf8");
      if (src.includes('"use client"')) return false;
      if (/^\s*redirect\(/m.test(src) && !/\bawait\b/.test(src)) return false;
      if (!/\bawait\b/.test(src)) return false;
      return !existsSync(f.replace(/page\.tsx$/, "loading.tsx"));
    });
  }

  it("do not wait in silence", () => {
    // Not zero, and the exception is named rather than filtered out:
    // src/app/join/[code]/page.tsx awaits findValidInvite and has no loading
    // state, but it is pre-auth and outside AppShell — the spec assigns
    // pre-auth to slice 5, which takes this to 0.
    expect(awaitingWithoutLoading()).toEqual(["src/app/join/[code]/page.tsx"]);
  });
});

describe("reduced motion", () => {
  it("stops motion without cancelling state changes", () => {
    const rule = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(
      css()
    );
    expect(rule, "the reduced-motion block is gone").not.toBeNull();
    const body = rule![1];
    // `animation: none` and `transition: none` cancel outright: an animation
    // never runs its final frame and a transitionend never fires. The
    // standard pattern collapses them to 1ms instead, which is not motion
    // but does complete.
    expect(body).not.toMatch(/animation:\s*none/);
    expect(body).not.toMatch(/transition:\s*none/);
    expect(body).toMatch(/animation-duration:\s*1ms/);
    expect(body).toMatch(/transition-duration:\s*1ms/);
    expect(body).toMatch(/animation-iteration-count:\s*1/);
  });
});

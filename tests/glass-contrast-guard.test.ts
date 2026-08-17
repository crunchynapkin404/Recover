// tests/glass-contrast-guard.test.ts — the hole tests/contrast-guard.test.ts
// structurally cannot cover.
//
// That guard governs OPAQUE grounds: it reads every `--surface-*` token and
// checks each text ink against it. `--glass-bg` is not a surface token and is
// not opaque, so nothing checked it — and from v0.100.1 it is once again the
// substrate Today's blocks actually sit on, which makes it the background a
// large share of the app's text is really rendered against.
//
// A translucent fill has no single colour to measure. It has a RANGE, decided
// by whatever shows through. So this composites the fill over every opaque
// ground it can plausibly sit on and takes the worst result, which is the
// same worst-case methodology the sibling guard uses for surfaces.
//
// WHY THIS IS NOT PARANOIA. The whole 2b.4 release exists to put a 4.5:1
// floor under this app's text. Re-introducing a substrate that no guard reads
// would mean the one surface most of that text sits on is the single surface
// exempt from the rule — and v0.99.0 already shipped exactly that shape of
// mistake twice (a guard reading only the first of six token blocks; an AA
// argument true for utilities and false for inline styles).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compositeOver, type Rgba } from "../src/lib/design/color-literals";
import { contrastRatio } from "../src/lib/design/contrast";
import {
  CSS_PATH,
  readDeclarations,
  resolvedThemeTokens,
  roleOfToken,
  type ThemeName,
} from "../src/lib/design/tokens";
import {
  findGlassNestingViolations,
  findGlassNestingViolationsInSrc,
  type GlassNestingViolation,
} from "../src/lib/design/jsx-glass";

const THEMES: ThemeName[] = ["light", "dark"];

// `readCss` (the helper `resolvedThemeTokens` uses internally) is not
// exported from tokens.ts, so this reads the file the same way
// tests/contrast-guard.test.ts does: CSS_PATH + readFileSync.
function declaredTokenNames(): string[] {
  return readDeclarations(readFileSync(CSS_PATH, "utf8")).map((d) => d.token);
}

/**
 * Every text ink, DERIVED. This was a hand-written array through v0.100.1,
 * which meant adding an ink token silently skipped the glass check while
 * passing the surface check — the same shape as the guard that read only
 * the first of six token blocks. Every token the shared classifier calls
 * `"text"` is checked over glass here, with no hand-written exemptions: a
 * hand-written exemption is exactly the failure mode this derivation exists
 * to remove. That includes `accent` (used as text — badges, links, the
 * "+ Add race" summary — and it does render on glass) and suffix-style ink
 * names like `coach-ink`, not just prefix-style `ink-*`.
 */
const TEXT_INKS = [...new Set(declaredTokenNames())]
  .filter((t) => roleOfToken(t) === "text")
  .sort();

it("derives its ink list from the stylesheet, not from a hand-written array", () => {
  // Exact inventory, not a floor: a floor lets a new text token silently go
  // unchecked, which is the bug this file exists to fix. If this fails
  // because a token was added or removed, confirm the new/changed token
  // clears the 4.5:1 glass floor above, then update this list — never
  // loosen it back to a length check.
  expect(TEXT_INKS).toEqual([
    "accent",
    "coach-ink",
    "connector-apple-ink",
    "connector-oura-ink",
    "connector-strava-ink",
    "connector-whoop-ink",
    "connector-withings-ink",
    "destructive-ink",
    "ghost-ink",
    "ink-muted",
    "ink-primary",
    "ink-race",
    "ink-secondary",
    "kind-debrief-ink",
    "kind-monthly-ink",
    "kind-morning-ink",
    "kind-warning-ink",
    "kind-weekly-ink",
    "success-ink",
    "viz-muted-ink",
    "warning-ink",
  ]);
});

/**
 * The opaque grounds glass ACTUALLY sits on, verified against the tree rather
 * than guessed: `.mesh-gradient` paints `--surface-base`, which is the page
 * flow every glass card lives in, and `--surface-raised` covers glass nested
 * in a raised card.
 *
 * `--surface-overlay` is deliberately NOT here, and not because it fails —
 * see the recorded-prohibition test at the bottom, which pins the number and
 * the reason. Overlay is used for tiles rendered INSIDE cards (stat tiles,
 * the cost line, the progress track), i.e. it stacks on top of glass, never
 * under it.
 *
 * "Verified against the tree" was prose, not code, until v0.101.1: this list
 * assumes glass never sits on glass — a ground `.glass` would put atop
 * ITSELF, not any surface token, and this file's own contrast maths would
 * not catch it either way. C2 (whole-branch review 2, 2026-08-13) found
 * exactly that on `/train?tab=fitness`: a `glass` `<section>` wrapping
 * `EmptyState`, whose own root is also `glass`. `describe("glass nesting
 * guard")` below is what makes "glass never sits on glass" a real,
 * AST-based assertion (`src/lib/design/jsx-glass.ts`) instead of this
 * paragraph.
 */
const GROUNDS = ["surface-base", "surface-raised"] as const;

const TEXT_FLOOR = 4.5;

/** `rgba(255, 255, 255, 0.72)` / `rgba(255,255,255,.05)` → [r,g,b,a]. */
function parseRgba(value: string): Rgba | null {
  const m =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/.exec(
      value.trim()
    );
  if (!m) return null;
  return [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    m[4] === undefined ? 1 : Number(m[4]),
  ];
}

describe("glass contrast guard", () => {
  it("reads a --glass-bg for every theme", () => {
    for (const theme of THEMES) {
      const tokens = resolvedThemeTokens()[theme];
      expect(
        tokens["glass-bg"],
        `${theme} defines no --glass-bg, so this guard would silently check ` +
          `nothing — the exact failure mode it exists to prevent`
      ).toBeTruthy();
    }
  });

  it("holds every text ink to 4.5:1 on glass, over every ground, in both themes", () => {
    for (const theme of THEMES) {
      const tokens = resolvedThemeTokens()[theme];
      const fill = parseRgba(tokens["glass-bg"]);

      // An opaque --glass-bg is legal (it is what light shipped before
      // v0.100.1) and is simply checked as-is.
      for (const ground of GROUNDS) {
        const composited =
          fill && fill[3] < 1
            ? compositeOver(fill, tokens[ground])
            : tokens["glass-bg"].startsWith("#")
              ? tokens["glass-bg"]
              : tokens[ground];

        for (const ink of TEXT_INKS) {
          const ratio = contrastRatio(tokens[ink], composited);
          expect(
            ratio,
            `${ink} on glass over ${ground} in ${theme} is ${ratio.toFixed(2)}:1 ` +
              `(glass ${tokens["glass-bg"]} composites to ${composited}). ` +
              `Text needs ${TEXT_FLOOR}:1. Either raise the glass alpha so the ` +
              `composite lands nearer its surface, or stop putting text on glass.`
          ).toBeGreaterThanOrEqual(TEXT_FLOOR);
        }
      }
    }
  });

  /**
   * A recorded prohibition, not an exemption.
   *
   * Dark glass over `--surface-overlay` composites to #2a2a2a, where
   * `--ink-muted` lands at ~4.16:1 — under the floor. No such stacking exists
   * today (overlay is used for tiles inside cards, never as a ground beneath
   * glass), so the guard above does not check it. This test exists so the
   * reason is written down and measured rather than lost: if you ever nest a
   * glass element on an overlay ground, muted text on it is illegal, and the
   * fix is to lower the dark glass alpha rather than to widen this file.
   *
   * It also fails if that number ever improves enough to make the stacking
   * legal, which is the signal to allow it deliberately.
   */
  it("records why glass may not sit on an overlay ground in dark", () => {
    const dark = resolvedThemeTokens().dark;
    const fill = parseRgba(dark["glass-bg"])!;
    const composited = compositeOver(fill, dark["surface-overlay"]);
    const ratio = contrastRatio(dark["ink-muted"], composited);
    expect(
      ratio,
      `dark glass over surface-overlay now measures ${ratio.toFixed(2)}:1 for ` +
        `ink-muted. If this has risen past ${TEXT_FLOOR}, the stacking is no ` +
        `longer illegal — add "surface-overlay" to GROUNDS and delete this test.`
    ).toBeLessThan(TEXT_FLOOR);
  });

  /**
   * A recorded DEFERRAL, with the number that justifies it.
   *
   * Light glass is still opaque, and that is deliberate as of v0.100.1.
   * Making it translucent was tried and measured: the axe pass went from 378
   * confirmed / 1559 indeterminate to 8 / 2372. Those 370 findings were not
   * fixed, they became uncomputable — axe cannot resolve contrast through a
   * translucent background, and `indeterminate` never gates the exit code.
   * Slices 2-8 would have inherited a gate that reports almost nothing.
   *
   * Slice 9 lifts `forcedTheme="dark"`, which is the first moment light mode
   * is reachable by anyone. It should set this to rgba(255,255,255,0.72) —
   * already verified above to clear the text floor on every ground — and
   * re-baseline axe in the same commit.
   *
   * This test fails the moment someone makes light glass translucent without
   * that re-baselining, which is the point.
   */
  it("keeps light glass opaque until slice 9 re-baselines axe", () => {
    const light = resolvedThemeTokens().light["glass-bg"];
    expect(
      parseRgba(light)?.[3] ?? 1,
      `light --glass-bg is "${light}". Translucent light glass moves ~370 axe ` +
        `findings from confirmed to indeterminate, which silently disarms the ` +
        `exit-code gate for every remaining slice. If this is slice 9 and you ` +
        `are re-baselining deliberately, delete this test and say so in the ` +
        `commit message.`
    ).toBe(1);
  });
});

/**
 * describe("glass nesting guard") — C2, whole-branch review 2, 2026-08-13.
 *
 * Turns the GROUNDS comment's "glass never sits on glass" from prose into an
 * AST-based assertion. See `src/lib/design/jsx-glass.ts` for the mechanism
 * and why a regex/line scan cannot do this (nesting is a tree relationship,
 * not a text pattern).
 *
 * PROVEN NOT VACUOUS FIRST. The three self-tests below feed the checker
 * synthetic fixtures with a known answer — two that must be flagged, one
 * that must not — before the real assertion trusts what it reports about
 * the actual tree. A checker that only ever runs against source that is
 * supposed to be clean can pass by being broken; these prove it can fail.
 */
describe("glass nesting guard", () => {
  it("self-test: catches a native element nested inside a glass element", () => {
    const src = `
      export function Bad() {
        return (
          <section className="glass p-4">
            <div className="glass rounded p-2">hi</div>
          </section>
        );
      }
    `;
    const violations = findGlassNestingViolations([
      { path: "fixture.tsx", text: src },
    ]);
    expect(
      violations.length,
      "the checker did not flag a native div.glass rendered inside a section.glass — it cannot be trusted"
    ).toBeGreaterThanOrEqual(1);
  });

  it("self-test: catches a glass-rooted component (like EmptyState) rendered inside a glass wrapper", () => {
    const src = `
      function Inner({ className }: { className?: string }) {
        return <div className={cn("glass rounded-2xl p-8", className)} />;
      }
      export function Bad() {
        return (
          <section className="glass p-4">
            <Inner />
          </section>
        );
      }
    `;
    const violations = findGlassNestingViolations([
      { path: "fixture.tsx", text: src },
    ]);
    expect(
      violations.length,
      "the checker did not flag a glass-rooted component (Inner, the EmptyState shape) rendered inside a glass wrapper — the exact C2 bug shape — it cannot be trusted"
    ).toBeGreaterThanOrEqual(1);
  });

  it("self-test: does not flag sibling glass elements or a glass-no-hover ancestor as glass", () => {
    const src = `
      export function Good() {
        return (
          <div className="p-4">
            <section className="glass p-2" />
            <section className="glass p-2" />
          </div>
        );
      }
      export function AlsoGood() {
        return (
          <nav className="glass-no-hover border p-2">
            <div className="glass p-1" />
          </nav>
        );
      }
    `;
    const violations = findGlassNestingViolations([
      { path: "fixture.tsx", text: src },
    ]);
    expect(
      violations,
      "false positive: sibling glass elements, or a glass-no-hover ancestor " +
        "(a different class — no fill, no blur of its own), got flagged as nesting"
    ).toEqual([]);
  });

  /**
   * Known, pre-existing glass-in-glass sites, OUTSIDE Train, that predate
   * this patch and this guard — found by this guard's own first real run
   * against the whole tree, not by the whole-branch review that scoped C2.
   * `git blame` puts both in 2026-07-18/07-21, three weeks before the Train
   * design-token slice this patch belongs to; neither file is touched by
   * `65da0fd..b50261e` (the reviewed range) or by v0.101.1. Recorded rather
   * than silently fixed here: fixing them is a Body-surface change this
   * patch's mandate (C1 + C2 on Train) does not cover, and doing it inside
   * a "Train patch" commit would bury an unrelated fix where nobody
   * reviewing v0.101.1 for Train would look for it. Flagged in the v0.101.1
   * report for a follow-up patch instead.
   *
   *  - `src/components/body/biomarker-list.tsx` — FIXED (F3, v0.102 task
   *    12, browser pass): the empty-rows branch no longer wraps EmptyState
   *    in the category card's own `glass` div; the "Biomarkers" label now
   *    sits outside a bare wrapper instead, same treatment as the Fitness
   *    fix below. Removed from this map entirely rather than left at 0 —
   *    an unlisted file already defaults to a ceiling of 0 via `?? 0`.
   *  - `src/components/body/journal-form.tsx` — two chip groups (behaviour
   *    tags, day flags) render `glass` toggle chips inside a `glass`
   *    section card. Still open; outside F3's scope.
   *
   * EXACT per-file counts, not a total ceiling, and checked in BOTH
   * directions like `OFFENDER_CEILINGS` in `tests/type-scale-guard.test.ts`:
   * a total ceiling would let one of these get fixed while a new, different
   * violation appeared elsewhere in the same file and the sum would not
   * move. Any file not listed here — Train included — must be at zero.
   */
  const KNOWN_PRE_EXISTING_GLASS_NESTING: Record<string, number> = {
    "src/components/body/journal-form.tsx": 2,
  };

  function describeViolation(v: GlassNestingViolation): string {
    return (
      `${v.file}:${v.outerLine} (<${v.outerTag}>) contains ` +
      `${v.file}:${v.innerLine} (<${v.innerTag}>) — both glass`
    );
  }

  it("never renders `.glass` inside `.glass` anywhere, beyond the known pre-existing sites above — Train included, at zero", () => {
    const violations = findGlassNestingViolationsInSrc();
    const byFile = new Map<string, GlassNestingViolation[]>();
    for (const v of violations) {
      byFile.set(v.file, [...(byFile.get(v.file) ?? []), v]);
    }

    const unexpected: string[] = [];
    for (const [file, vs] of byFile) {
      const allowed = KNOWN_PRE_EXISTING_GLASS_NESTING[file] ?? 0;
      if (vs.length > allowed) {
        unexpected.push(
          `${file}: ${vs.length} found, ${allowed} known — new site(s):\n` +
            vs.map(describeViolation).join("\n")
        );
      }
    }
    expect(unexpected, unexpected.join("\n\n")).toEqual([]);

    // Ceilings must stay pinned to the real count too, or a fixed site
    // becomes a free, unattributed pass for a new one in the same file —
    // the same discipline `OFFENDER_CEILINGS` enforces.
    const stale = Object.entries(KNOWN_PRE_EXISTING_GLASS_NESTING)
      .filter(([file, allowed]) => (byFile.get(file)?.length ?? 0) < allowed)
      .map(
        ([file, allowed]) =>
          `${file}: ceiling ${allowed}, real ${byFile.get(file)?.length ?? 0} — re-pin it down`
      );
    expect(stale, stale.join("\n")).toEqual([]);
  });
});

// tests/contrast-guard.test.ts — Phase 2b.4's first guardrail
// (docs/specs/2026-08-11-2b4-visual-redesign-design.md).
//
// The premise of v0.99.0 is that 134 ink usages measured between 2.6:1 and
// 3.8:1 — below the 4.5:1 AA floor — because nothing ever checked. This is
// the check. It reads the tokens out of the CSS that ships, so it cannot
// pass against a stale copy of the palette.
//
// WORST CASE, NOT BEST CASE: each ink is asserted against every surface it
// is allowed to appear on, so a token that only passes on the most flattering
// background fails here. The light `hairline` was #949494 in the approved
// design and measured 2.81:1 against surface-base; this guard is why it is
// #8a8a8a.
//
// ── WHAT THE WHOLE-BRANCH REVIEW (2026-08-11) FOUND WRONG WITH IT ──────────
// C1: src/lib/design/tokens.ts read only the FIRST `:root` and the FIRST
// `.dark` block of six, so four blocks — the glass / login-input /
// chat-bubble tokens and the entire `--viz-*` palette including chart TEXT —
// were governed by nothing. Restoring `--viz-muted-ink:
// rgba(255,255,255,0.3)`, the ~2.7:1 value this release exists to eliminate,
// passed 34/34.
//
// I6: this file's own remediation message said "add these to GOVERNED in
// src/lib/design/tokens.ts or they ship unchecked" — but the ratios were
// asserted from the separate hand-written TEXT_INKS/SURFACES arrays below it.
// Following the instruction did not get a token checked: `--ink-hint:
// #b0b0b0` (measured 2.17:1 on white; the review's 1.94:1 does not
// reproduce) added to both blocks *and* to GOVERNED still passed, and the
// test count did not even change. The advice was what made the guard
// vacuous.
//
// ── THE SHAPE THAT REPLACES BOTH ──────────────────────────────────────────
// There is no list of governed tokens any more, in this file or in tokens.ts.
// The inventory is every declaration in every `:root`/`.dark` block, read
// from the CSS. What each token is FOR comes from its NAME
// (`roleOfToken`) — so `--ink-hint`, `--viz-muted-ink` and a token added to
// the sixth block tomorrow are all checked for the same reason, and this
// file's advice ("name it `*-ink` and it is checked") is the mechanism rather
// than a description of one.
//
// The register at the bottom is the fail-closed half. A token that no rule
// can evaluate must be waived BY NAME, with a reason — and the guard fails
// both when a token is missing from the register and when a waiver is no
// longer needed. That is the opposite of GOVERNED, which failed open: a
// forgotten token simply went unchecked and silent.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { contrastRatio } from "../src/lib/design/contrast";
import {
  compositeOver,
  parseColor,
  type Rgba,
} from "../src/lib/design/color-literals";
import {
  compositeMeshCorners,
  compositeMeshWorstCase,
} from "../src/lib/design/mesh-composite";
import {
  CSS_PATH,
  extractThemeBlocks,
  readDeclarations,
  readThemeTokens,
  resolveToken,
  roleOfToken,
  type ThemeName,
} from "../src/lib/design/tokens";

const TEXT_FLOOR = 4.5; // WCAG 2.2 SC 1.4.3, normal text
const NON_TEXT_FLOOR = 3.0; // WCAG 2.2 SC 1.4.11
const OPAQUE_HEX = /^#[0-9a-fA-F]{6}$/;
const THEMES: readonly ThemeName[] = ["light", "dark"];

/**
 * Tokens no rule in this file can evaluate, each with the reason. Being in
 * here is not "unimportant" — it is a recorded gap, and the two assertions
 * at the bottom keep it honest: a token missing from the register fails the
 * build, and a waiver that is no longer needed fails the build too.
 */
const WAIVED: Record<string, string> = {
  // ── shadcn compatibility layer ─────────────────────────────────────────
  // Text that sits on the accent/primary FILL, not on a surface. Checking it
  // needs an ink×fill matrix this foundations slice does not introduce.
  "primary-foreground": "ink on the --primary fill, not on a surface",
  "accent-foreground": "ink on the --accent fill, not on a surface",
  "sidebar-primary-foreground":
    "ink on the --sidebar-primary fill, not on a surface",
  // Chip/row fills shadcn paints behind small controls. Not surfaces: no ink
  // token is declared against them, so there is no pair to assert.
  secondary: "chip fill, not a surface any ink token is declared against",
  muted: "chip fill, not a surface any ink token is declared against",
  "sidebar-accent":
    "chip fill, not a surface any ink token is declared against",
  sidebar: "sidebar fill; dark overrides it with a literal, light aliases card",
  // Chromatic semantic/series colours, not ink or surface.
  destructive: "semantic brand colour, not ink or surface",
  "chart-1": "chart series colour, not ink or surface",
  "chart-2": "chart series colour, not ink or surface",
  "chart-3": "chart series colour, not ink or surface",
  "chart-4": "chart series colour, not ink or surface",
  "chart-5": "chart series colour, not ink or surface",
  radius: "not a colour",

  // ── Component effect tokens (Task 6b) ──────────────────────────────────
  // Dark keeps the ORIGINAL translucent literals on purpose so dark mode's
  // pixels do not move; a translucent veil over a translucent veil has no
  // single ratio to assert. Light resolves to a surface/hairline token and is
  // covered there.
  "glass-bg": "translucent frosted-glass veil in dark by design",
  "glass-border": "translucent frosted-glass edge in dark by design",
  "glass-hover-shadow": "drop shadow, not ink or surface",
  "login-input-bg": "translucent field fill in dark by design",
  "login-input-border": "translucent field edge in dark by design",
  "login-input-focus-bg": "translucent field fill in dark by design",
  "chat-bubble-ai-bg": "translucent bubble fill in dark by design",
  "chat-bubble-ai-border": "translucent bubble edge in dark by design",
  "chat-bubble-user-bg": "translucent bubble fill in dark by design",
  "chat-bubble-user-border": "translucent bubble edge in dark by design",

  // ── Non-text hairlines that are translucent in both themes ─────────────
  // A 6%-white rule on near-black is nowhere near 3:1 and is not meant to
  // be: it is a barely-there row separator, not a UI-component boundary.
  // Task 6b preserved dark's exact original values, and moving them is a
  // visible change no foundations slice may make. Recorded, not asserted.
  "row-divider": "translucent row separator; deliberately below 3:1",
  "viz-grid": "translucent chart gridline; deliberately below 3:1",
  "viz-axis": "translucent chart axis rule; deliberately below 3:1",

  // ── Data-viz brand palette ─────────────────────────────────────────────
  "viz-series-1": "chart series colour, not ink or surface",
  "viz-series-2": "chart series colour, not ink or surface",
  "viz-series-3": "chart series colour, not ink or surface",
  "viz-series-5": "chart series colour, not ink or surface",
  "viz-status-good": "semantic status colour, not ink or surface",
  "viz-status-warning": "semantic status colour, not ink or surface",
  "viz-status-critical": "semantic status colour, not ink or surface",

  // ── Coach inbox kind tiles (Task 5) ─────────────────────────────────────
  // Each `--kind-*-tint`/`--ghost-tint` is that kind's own tile ground, not
  // one of the app's three neutral --surface-* tokens, so the generic
  // role="surface" loop above never picks it up and would leave it
  // unaccounted. It is not unchecked, though: the "kind ink/tint pairs"
  // describe block below asserts its paired `-ink` token at 4.5:1 against it
  // directly, derived from the same declaredTokens list this file reads —
  // not a hand-written ratio.
  "kind-morning-tint":
    "this kind's own tile ground; checked directly against --kind-morning-ink below",
  "kind-debrief-tint":
    "this kind's own tile ground; checked directly against --kind-debrief-ink below",
  "kind-weekly-tint":
    "this kind's own tile ground; checked directly against --kind-weekly-ink below",
  "kind-warning-tint":
    "this kind's own tile ground; checked directly against --kind-warning-ink below",
  "kind-monthly-tint":
    "this kind's own tile ground; checked directly against --kind-monthly-ink below",
  "ghost-tint":
    "this kind's own tile ground; checked directly against --ghost-ink below",

  // ── Semantic error ink/tint (chat error banner, dictation-active mic) ──
  "destructive-tint":
    "this token's own tile ground; checked directly against --destructive-ink below",

  // ── Connector brand ink/tint (Settings connector card avatar chip) ─────
  "connector-strava-tint":
    "this connector's own tile ground; checked directly against --connector-strava-ink below",
  "connector-whoop-tint":
    "this connector's own tile ground; checked directly against --connector-whoop-ink below",
  "connector-withings-tint":
    "this connector's own tile ground; checked directly against --connector-withings-ink below",
  "connector-oura-tint":
    "this connector's own tile ground; checked directly against --connector-oura-ink below",
  "connector-apple-tint":
    "this connector's own tile ground; checked directly against --connector-apple-ink below",

  // ── Semantic warning/success ink/tint (Task 8b) ─────────────────────────
  "warning-tint":
    "this token's own tile ground; checked directly against --warning-ink below",
  "success-tint":
    "this token's own tile ground; checked directly against --success-ink below",
};

const css = readFileSync(CSS_PATH, "utf8");
const rawTokens = readThemeTokens(css);
const declarations = readDeclarations(css);
const declaredTokens = [...new Set(declarations.map((d) => d.token))];

function resolvedValue(theme: ThemeName, token: string): string | null {
  return resolveToken(rawTokens[theme], token)?.value ?? null;
}

/** True when a pure alias chain lands on a token that carries a role. */
function aliasCovered(theme: ThemeName, token: string): boolean {
  const chain = resolveToken(rawTokens[theme], token)?.chain ?? [];
  return chain.slice(1).some((t) => roleOfToken(t) !== null);
}

function tokensWithRole(role: string): string[] {
  return declaredTokens.filter((t) => roleOfToken(t) === role);
}

/** A surface is the ground every ratio is measured against, so it must be opaque. */
function surfaceHex(theme: ThemeName, token: string): string {
  const value = resolvedValue(theme, token);
  if (value === null || !OPAQUE_HEX.test(value)) {
    throw new Error(
      `${theme}: --${token} is a surface, so it must resolve to an opaque ` +
        `six-digit hex — text is measured against it. Got ${String(value)}.`
    );
  }
  return value;
}

/**
 * An ink's colour as RGBA. Translucent is allowed and MEASURED (composited
 * over each surface below) rather than banned: a translucent ink over a known
 * surface has a determinate ratio, and measuring it is what catches
 * `rgba(255,255,255,0.3)` at 2.68:1 instead of merely disliking it. What is
 * not allowed is a value nobody can evaluate.
 */
function inkColor(theme: ThemeName, token: string, role: string): Rgba {
  const value = resolvedValue(theme, token);
  if (value === null) {
    throw new Error(
      `${theme}: --${token} is ${role} with no value in this theme — it is ` +
        `declared in the other theme's block only, or its var() chain is ` +
        `dangling, so ${theme} renders it as an invalid, inherited colour.`
    );
  }
  const rgba = parseColor(value);
  if (!rgba) {
    throw new Error(
      `${theme}: --${token} is ${role} but resolves to ${value}, which this ` +
        `guard cannot evaluate. Point it at a token, or use a hex/rgb/hsl ` +
        `value so its ratio can be measured.`
    );
  }
  return rgba;
}

describe("contrast guard", () => {
  it("reads every :root/.dark block in globals.css, not just the first", () => {
    // The C1 regression test. Counted from the file rather than pinned to a
    // number, so adding a seventh block cannot quietly go unread.
    const written = css.match(/^(?::root|\.dark)\s*\{/gm) ?? [];
    expect(
      extractThemeBlocks(css).length,
      "tokens.ts must read every theme block; a non-global regex reads one"
    ).toBe(written.length);
    expect(written.length).toBeGreaterThan(1);
  });

  for (const theme of THEMES) {
    describe(theme, () => {
      const surfaces = tokensWithRole("surface");

      for (const surface of surfaces) {
        it(`${surface} is an opaque surface`, () => {
          expect(surfaceHex(theme, surface)).toMatch(OPAQUE_HEX);
        });
      }

      for (const ink of tokensWithRole("text")) {
        for (const surface of surfaces) {
          it(`${ink} on ${surface} clears ${TEXT_FLOOR}:1`, () => {
            const ground = surfaceHex(theme, surface);
            const composite = compositeOver(
              inkColor(theme, ink, "a text ink"),
              ground
            );
            const ratio = contrastRatio(composite, ground);
            expect(
              ratio,
              `${theme}: --${ink} (${resolvedValue(theme, ink)} → ` +
                `${composite}) on --${surface} (${ground}) is ` +
                `${ratio.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(TEXT_FLOOR);
          });
        }
      }

      for (const token of tokensWithRole("non-text")) {
        // Translucent hairlines have no single ratio and are waived by name
        // in WAIVED; the opaque ones carry 1.4.11's floor.
        const value = resolvedValue(theme, token);
        if (value === null || !OPAQUE_HEX.test(value)) continue;
        for (const surface of surfaces) {
          it(`${token} on ${surface} clears ${NON_TEXT_FLOOR}:1`, () => {
            const ground = surfaceHex(theme, surface);
            const ratio = contrastRatio(value, ground);
            expect(
              ratio,
              `${theme}: --${token} (${value}) on --${surface} (${ground}) ` +
                `is ${ratio.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
          });
        }
      }
    });
  }

  /**
   * ── The mesh gradient as a text backdrop (v0.108.0, slice 6 phase B) ─────
   * `activity-detail`'s <h1>, its breadcrumb and its `sport · date · provider`
   * line sit directly on `AppShell`'s mesh gradient with no card behind them.
   * axe reports that page as 0 confirmed and 240 INDETERMINATE, and the zero
   * means the rule never ran, not that it passed: `color-contrast` cannot
   * resolve a non-uniform backdrop, so it returns `contrastRatio: 0` and files
   * every node under `incomplete`.
   *
   * The loop above cannot cover them either — it measures ink against the
   * three flat `--surface-*` tokens, and the gradient is none of those. So the
   * ratio is asserted here instead, against the worst composite the gradient
   * can produce, which is what turns "indeterminate" back into a fact. See
   * src/lib/design/mesh-composite.ts for how that composite is derived from
   * the CSS and the shell rather than restated here.
   */
  describe("mesh-gradient composite", () => {
    /** An ink's ratio against an opaque ground, composited if translucent. */
    function ratioOn(theme: ThemeName, ink: string, ground: string): number {
      return contrastRatio(
        compositeOver(inkColor(theme, ink, "a text ink"), ground),
        ground
      );
    }

    for (const theme of THEMES) {
      // Called inside each `it`, never at collection time. mesh-composite.ts
      // reads app-shell.tsx from disk and throws on anything it cannot reduce;
      // at collection that throw is a FILE-level error, which takes the other
      // 220-odd token/surface/waiver assertions in this file down with it and
      // reports the wrong thing as broken.
      const worst = () => compositeMeshWorstCase(css, theme);

      it(`${theme}: reads every layer of the backdrop`, () => {
        const w = worst();
        expect(w.hex).toMatch(OPAQUE_HEX);
        // Two blooms in the CSS rule, two blurred blobs in the shell. A
        // parser that has gone blind returns a bare --surface-base and every
        // ratio below passes for the wrong reason.
        expect(
          w.layers.length,
          "found no mesh layers, so the 'worst case' is just --surface-base"
        ).toBeGreaterThanOrEqual(4);
        expect(w.base).toMatch(OPAQUE_HEX);
      });

      for (const ink of ["ink-primary", "ink-secondary"]) {
        it(`${theme}: --${ink} clears ${TEXT_FLOOR}:1 over the composite`, () => {
          const ground = worst().hex;
          const ratio = ratioOn(theme, ink, ground);
          expect(
            ratio,
            `${theme}: --${ink} (${resolvedValue(theme, ink)}) on the mesh ` +
              `gradient's worst-case composite (${ground}) is ` +
              `${ratio.toFixed(2)}:1`
          ).toBeGreaterThanOrEqual(TEXT_FLOOR);
        });
      }

      /**
       * ── --ink-muted is CARD-ONLY ink, and this is where that was found ───
       * Measured 2026-08-17, writing this guard. `--ink-muted` is the floor
       * of the text ramp: it clears 4.5:1 on all three flat `--surface-*`
       * tokens (the loop above proves it) with very little to spare, and the
       * gradient spends that margin. Over the worst-case composite it comes
       * out at 3.71:1 in light and 4.20:1 in dark.
       *
       * That is asserted as a FACT rather than left as a passing silence,
       * because the useful signal is when it changes. If a future gradient or
       * a raised `--ink-muted` makes this test fail, ink-muted has become
       * safe un-carded and this restriction should be deleted — the same
       * two-sided shape as the waiver register at the bottom of this file.
       *
       * What the app must therefore not do is put `text-ink-muted` on text
       * with no card behind it. On `activity-detail` that is the `<h1>`, the
       * breadcrumb and the `sport · date · provider` line, which all take
       * `--ink-secondary` or better; every other muted label on that page
       * sits inside an opaque `bg-surface-raised` card, where the loop above
       * is the thing that proves it.
       *
       * RAISING `--ink-muted` INSTEAD was considered and is not this slice's
       * to make: the token is the text floor for the whole app, it was set to
       * clear the surfaces exactly, and moving it re-measures every surface
       * in every theme.
       */
      it(`${theme}: --ink-muted does NOT clear the floor — it is card-only ink`, () => {
        const ground = worst().hex;
        const ratio = ratioOn(theme, "ink-muted", ground);
        expect(
          ratio,
          `${theme}: --ink-muted now measures ${ratio.toFixed(2)}:1 on the ` +
            `mesh composite (${ground}). If that is at or above ` +
            `${TEXT_FLOOR}, it is safe un-carded now — delete this ` +
            `assertion and fold ink-muted into the loop above`
        ).toBeLessThan(TEXT_FLOOR);
      });
    }

    /**
     * The aggregate above is a bound across all four layers at peak, and no
     * single pixel carries all four. This pins the conclusion to a composite
     * that plainly IS reachable: ONE of `.mesh-gradient`'s own 8% blooms, at
     * its own centre, over nothing else. Even that most-flattering single
     * bloom puts --ink-muted under the floor in light, so the finding is a
     * property of the gradient rather than of how conservative the bound is.
     *
     * Scoped to the two CSS blooms deliberately. The shell's blurred blobs
     * are 5%, and one of THOSE alone leaves --ink-muted at 4.52:1 — over the
     * floor. Writing this assertion across all four single-layer corners
     * claimed more than is true and failed, which is the whole reason it is
     * worth pinning the reachable case separately from the bound.
     */
    it("light: one .mesh-gradient bloom alone puts --ink-muted under the floor", () => {
      const single = compositeMeshCorners(css, "light").filter(
        (corner) =>
          corner.layers.length === 1 &&
          corner.layers[0].source.startsWith(".mesh-gradient")
      );
      expect(single.length).toBe(2);

      const best = single
        .map((corner) => ({
          corner,
          ratio: contrastRatio(
            compositeOver(
              inkColor("light", "ink-muted", "a text ink"),
              corner.hex
            ),
            corner.hex
          ),
        }))
        .reduce((a, b) => (a.ratio > b.ratio ? a : b));

      expect(
        best.ratio,
        `the most flattering single bloom (${best.corner.layers[0].source} → ` +
          `${best.corner.hex}) still measures ${best.ratio.toFixed(2)}:1`
      ).toBeLessThan(TEXT_FLOOR);
    });
  });

  /**
   * ── Coach inbox kind tiles (Task 5) ──────────────────────────────────────
   * `KIND_STYLE` renders each history-panel tile as ink-on-its-own-tint, not
   * ink-on-an-app-surface — the tinted background IS the ground WCAG is
   * measured against, so this pairs each `--kind-*-ink` (and `--ghost-ink`)
   * with its same-prefixed `--*-tint` sibling directly, rather than relying
   * on the generic text-vs-surface loop above (which only knows the app's
   * three neutral surfaces; a kind tile never sits on one of those). The
   * PAIRING itself is derived from the token names already read out of the
   * CSS above — not a hand-written list — so a future `--kind-*-ink` /
   * `--kind-*-tint` pair is picked up the same way without anyone editing
   * this file.
   */
  function inkTintPairs(): [string, string][] {
    return declaredTokens
      .filter((t) => t.endsWith("-ink"))
      .map((ink): [string, string] => [ink, ink.replace(/-ink$/, "-tint")])
      .filter(([, tint]) => declaredTokens.includes(tint));
  }

  describe("kind ink/tint pairs", () => {
    const pairs = inkTintPairs();

    it("finds the fourteen kind/connector/ghost/destructive/success/warning pairs declared so far", () => {
      // Not a floor: this is the C1/I6 lesson (see the file header) applied
      // to a second list — if this count doesn't move when a pair is added
      // or removed, the derivation above is checking nothing. `destructive-
      // ink`/`-tint` (the chat error banner / dictation-active mic) joined
      // the original six Task 5 pairs without anyone editing the derivation
      // itself — only this expectation, which is the point. v0.106.0 added
      // the five connector-*-ink/tint pairs the same way, and Task 8b added
      // `success-ink`/`-tint` and `warning-ink`/`-tint`: Settings had been
      // borrowing `--kind-warning-ink`, a coach-inbox taxonomy colour that is
      // byte-identical to `--destructive-ink` in both themes, so a warning
      // rendered indistinguishably from an error. These are Settings' own
      // amber/green pair, not aliases of the inbox tokens.
      expect(pairs.map(([ink]) => ink).sort()).toEqual([
        "connector-apple-ink",
        "connector-oura-ink",
        "connector-strava-ink",
        "connector-whoop-ink",
        "connector-withings-ink",
        "destructive-ink",
        "ghost-ink",
        "kind-debrief-ink",
        "kind-monthly-ink",
        "kind-morning-ink",
        "kind-warning-ink",
        "kind-weekly-ink",
        "success-ink",
        "warning-ink",
      ]);
    });

    for (const theme of THEMES) {
      describe(theme, () => {
        for (const [ink, tint] of pairs) {
          it(`${ink} on its own ${tint} clears ${TEXT_FLOOR}:1`, () => {
            const ground = resolvedValue(theme, tint);
            if (ground === null || !OPAQUE_HEX.test(ground)) {
              throw new Error(
                `${theme}: --${tint} is a kind tile's own ground, so it ` +
                  `must resolve to an opaque six-digit hex. Got ` +
                  `${String(ground)}.`
              );
            }
            const composite = compositeOver(
              inkColor(theme, ink, "a kind-tile ink"),
              ground
            );
            const ratio = contrastRatio(composite, ground);
            expect(
              ratio,
              `${theme}: --${ink} (${resolvedValue(theme, ink)} → ` +
                `${composite}) on --${tint} (${ground}) is ` +
                `${ratio.toFixed(2)}:1`
            ).toBeGreaterThanOrEqual(TEXT_FLOOR);
          });
        }
      });
    }
  });

  it("every token in every theme block is checked, aliased, or waived", () => {
    const unaccounted = declaredTokens.filter((token) => {
      if (token in WAIVED) return false;
      const role = roleOfToken(token);
      if (role === "text" || role === "surface") return false;
      if (role === "non-text") {
        // Only counts as checked where it is opaque in every theme.
        return THEMES.some((theme) => {
          const value = resolvedValue(theme, token);
          return value === null || !OPAQUE_HEX.test(value);
        });
      }
      return !THEMES.every((theme) => aliasCovered(theme, token));
    });
    expect(
      unaccounted,
      "these tokens are governed by nothing. Give one a role by NAMING it — " +
        "`--*-ink` for text, `--surface-*` for a surface, " +
        "`--*-hairline|-divider|-grid|-axis` for non-text — which is what " +
        "makes it checked; point it at a token with var(--…); or add it to " +
        "WAIVED in tests/contrast-guard.test.ts with the reason no rule here " +
        "can evaluate it."
    ).toEqual([]);
  });

  it("the waiver register has no stale or invented entries", () => {
    const notDeclared = Object.keys(WAIVED).filter(
      (t) => !declaredTokens.includes(t)
    );
    expect(
      notDeclared,
      "WAIVED names tokens globals.css no longer declares — delete them, or " +
        "the register hides the next token that takes the same name"
    ).toEqual([]);

    const nowCheckable = Object.keys(WAIVED).filter((token) => {
      const role = roleOfToken(token);
      if (role === "text" || role === "surface") return true;
      if (role === "non-text") {
        return THEMES.every((theme) => {
          const value = resolvedValue(theme, token);
          return value !== null && OPAQUE_HEX.test(value);
        });
      }
      return THEMES.every((theme) => aliasCovered(theme, token));
    });
    expect(
      nowCheckable,
      "these are checkable now — remove their waivers so the ratios are " +
        "actually asserted"
    ).toEqual([]);
  });
});

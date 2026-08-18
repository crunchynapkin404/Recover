/**
 * The worst-case backdrop `AppShell`'s mesh gradient can put behind text —
 * derived from the CSS and the shell that ship, for
 * tests/contrast-guard.test.ts.
 *
 * WHY THIS EXISTS. `activity-detail` reports 0 confirmed contrast violations
 * and 240 INDETERMINATE nodes. The zero is not a pass: axe's `color-contrast`
 * rule cannot resolve a NON-UNIFORM backdrop, so on any node whose ancestry
 * bottoms out in `.mesh-gradient` it returns `contrastRatio: 0` and files the
 * node under `incomplete` — the rule never ran. Most of that 240 goes away by
 * swapping translucent cards for opaque ones, because then axe has a flat
 * ground to measure against. What is left is the text with no card at all: the
 * page's `<h1>`, its breadcrumb, its `sport · date · provider` line. Those sit
 * on the gradient itself, and no amount of tokenising makes axe able to see
 * them.
 *
 * The alternative to this module was a sentence in a plan asserting the inks
 * are fine on the gradient. This computes it instead, from the same CSS the
 * browser paints, so the claim fails the build when the gradient changes.
 *
 * WHAT "WORST CASE" MEANS HERE, EXACTLY. The gradient is four translucent
 * layers over `--surface-base`, each with its own peak alpha at its own point
 * on the page — the two radial blooms in `.mesh-gradient`, and the two blurred
 * blobs the shell paints over it. No single pixel carries all four peaks. But
 * an ink can land on any pixel, so the honest bound is the extreme over the
 * whole box of reachable alphas, not the value at some representative point.
 *
 * Each composited channel is MULTILINEAR in those alphas (`out = src·α +
 * dst·(1−α)`, applied layer over layer), and a multilinear function on a box
 * attains its extremes at the box's vertices — so evaluating the 2^n corners,
 * where every layer is either absent or at peak alpha, reaches the extreme
 * value of every channel. Relative luminance is monotonically increasing in
 * each channel, so the channel-wise minimum of those corners bounds the
 * darkest backdrop reachable and the channel-wise maximum bounds the
 * lightest. That is a BOUND, deliberately: it can be very slightly stricter
 * than any real pixel, and stricter is the only direction a contrast guard is
 * allowed to be wrong in.
 *
 * Light theme takes the darkest bound and dark theme the lightest, because
 * those are the ones that shrink the ratio for the ink each theme actually
 * uses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { findColorLiterals, type Rgba } from "./color-literals";
import { readThemeTokens, resolveToken, type ThemeName } from "./tokens";

export const APP_SHELL_PATH = join(
  process.cwd(),
  "src/components/app-shell.tsx"
);

const OPAQUE_HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The Tailwind palette entries `AppShell`'s depth layers name. Tailwind's
 * values, not ours, so this is a lookup rather than a decision — and an
 * unknown one THROWS rather than being skipped, because a layer this module
 * silently dropped would make the "worst case" quietly too flattering, which
 * is the exact failure mode the whole file exists to prevent.
 */
const TAILWIND: Record<string, string> = {
  "emerald-500": "#10b981",
  "blue-500": "#3b82f6",
  white: "#ffffff",
  black: "#000000",
};

export interface MeshLayer {
  /** Where it was read from, for the guard's failure message. */
  readonly source: string;
  /** Exactly as written in the source. */
  readonly text: string;
  readonly rgba: Rgba;
}

export interface MeshComposite {
  /** The backdrop, opaque `#rrggbb`. */
  readonly hex: string;
  /** The opaque ground everything was composited over. */
  readonly base: string;
  /** The layers that contributed to THIS composite, in paint order. */
  readonly layers: readonly MeshLayer[];
}

/** `--surface-base` for a theme, which every layer is painted over. */
function surfaceBase(css: string, theme: ThemeName): string {
  const value = resolveToken(
    readThemeTokens(css)[theme],
    "surface-base"
  )?.value;
  if (!value || !OPAQUE_HEX.test(value)) {
    throw new Error(
      `mesh-composite: --surface-base in ${theme} is ${String(value)}, not an ` +
        `opaque six-digit hex. Every mesh layer is composited over it, so ` +
        `there is no ground to measure the gradient against without it.`
    );
  }
  return value;
}

/**
 * The translucent stops of `.mesh-gradient`'s own `background`. The rule's
 * final stop is `var(--surface-base)`, which `findColorLiterals` blanks along
 * with every other custom-property reference — correct here, since that stop
 * IS the ground and is handled by `surfaceBase` above. `transparent` carries
 * no colour and is likewise not matched, so what comes back is exactly the
 * coloured blooms.
 *
 * CSS paints the FIRST listed background layer on TOP, so the list is
 * reversed into paint order.
 */
function meshBloomLayers(css: string): MeshLayer[] {
  const rule = /\.mesh-gradient\s*\{([\s\S]*?)\}/.exec(css);
  if (!rule) {
    throw new Error(
      "mesh-composite: no `.mesh-gradient { … }` rule in globals.css — the " +
        "backdrop this module measures was renamed or removed, and returning " +
        "a bare --surface-base here would silently weaken the guard"
    );
  }
  const background = /background:\s*([\s\S]*?);/.exec(rule[1]);
  if (!background) {
    throw new Error(
      "mesh-composite: `.mesh-gradient` declares no `background` — nothing " +
        "to composite"
    );
  }
  const layers = findColorLiterals(background[1]).map((literal, i) => {
    if (!literal.rgba) {
      throw new Error(
        `mesh-composite: .mesh-gradient's background contains ` +
          `${literal.text}, which cannot be reduced to RGBA. A stop this ` +
          `module cannot evaluate must not be dropped from a worst case.`
      );
    }
    return {
      source: `.mesh-gradient stop ${i + 1} (${literal.text})`,
      text: literal.text,
      rgba: literal.rgba,
    };
  });
  return layers.reverse();
}

/**
 * `AppShell`'s two blurred depth blobs, read as Tailwind utilities.
 *
 * The whole file is scanned rather than just the `fixed inset-0` container:
 * the shell is small and holds nothing else with a background, and including
 * a background it grows later would only ever make the bound STRICTER, which
 * is the safe direction. `blur-[120px]` spreads each blob without capping its
 * alpha, so peak alpha is still reachable and the peak is what is used.
 */
function shellBlobLayers(source: string): MeshLayer[] {
  const out: MeshLayer[] = [];
  for (const m of source.matchAll(
    /\bbg-((?:[a-z]+-\d{2,3})|white|black)\/(\d{1,3})\b/g
  )) {
    const [, name, alpha] = m;
    const hex = TAILWIND[name];
    if (!hex) {
      throw new Error(
        `mesh-composite: app-shell.tsx paints bg-${name}/${alpha}, and ` +
          `"${name}" is not in this module's Tailwind lookup. Add its value ` +
          `— a depth layer left out of the composite makes the worst case ` +
          `look better than the page.`
      );
    }
    out.push({
      source: `app-shell bg-${name}/${alpha}`,
      text: `bg-${name}/${alpha}`,
      rgba: [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
        Number(alpha) / 100,
      ],
    });
  }
  return out;
}

/** `out = src·α + dst·(1−α)`, per channel, in place over an RGB triple. */
function over(fg: Rgba, dst: readonly number[]): number[] {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + dst[i] * (1 - a));
}

/**
 * Every corner of the alpha box: each layer either absent or at its peak,
 * composited bottom-up over `--surface-base`. Exported because the aggregate
 * worst case below is a BOUND, and some claims are only honest against a
 * composite a single pixel demonstrably has — "one bloom at its own centre"
 * is reachable in a way "all four at once" is not.
 */
export function compositeMeshCorners(
  css: string,
  theme: ThemeName,
  shellSource: string = readFileSync(APP_SHELL_PATH, "utf8")
): MeshComposite[] {
  const base = surfaceBase(css, theme);
  const all = [...meshBloomLayers(css), ...shellBlobLayers(shellSource)];
  const ground = [
    parseInt(base.slice(1, 3), 16),
    parseInt(base.slice(3, 5), 16),
    parseInt(base.slice(5, 7), 16),
  ];

  const out: MeshComposite[] = [];
  for (let mask = 0; mask < 1 << all.length; mask++) {
    const layers = all.filter((_, i) => mask & (1 << i));
    let rgb = ground;
    all.forEach((layer, i) => {
      if (mask & (1 << i)) rgb = over(layer.rgba, rgb);
    });
    out.push({ hex: toHex(rgb), base, layers });
  }
  return out;
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb
    .map((c) => Math.round(c).toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * The worst backdrop the mesh gradient can put behind text in `theme`:
 * darkest reachable in light, lightest in dark. See the file header for why
 * the corners of the alpha box suffice, and why the result is a bound rather
 * than a specific pixel — in practice it lands within one 8-bit step of the
 * all-layers-at-peak corner, so the conservatism costs nothing real.
 *
 * `layers` on the result is every layer, since the bound is taken across all
 * of them rather than from one corner.
 */
export function compositeMeshWorstCase(
  css: string,
  theme: ThemeName,
  shellSource: string = readFileSync(APP_SHELL_PATH, "utf8")
): MeshComposite {
  const corners = compositeMeshCorners(css, theme, shellSource);
  const base = corners[0].base;
  const pick = theme === "light" ? Math.min : Math.max;

  const extreme = [0, 1, 2].map((c) =>
    corners
      .map((corner) => parseInt(corner.hex.slice(1 + c * 2, 3 + c * 2), 16))
      .reduce((a, b) => pick(a, b))
  );

  return {
    hex: toHex(extreme),
    base,
    layers: corners[corners.length - 1].layers,
  };
}

/**
 * The worst-case backdrop the mesh gradient can put behind text — derived from
 * the CSS and the depth layers that ship, for tests/contrast-guard.test.ts.
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
 * WHAT "WORST CASE" MEANS HERE, EXACTLY. The gradient is a stack of
 * translucent layers over `--surface-base`: the two radial blooms in
 * `.mesh-gradient`, plus every blurred blob `gradient-depth.tsx` declares. No
 * single pixel carries every peak at once — and since v0.110.0 no single PAGE
 * even declares every layer, because that file holds both the `app` and `auth`
 * variants and a surface renders one of them. The bound is taken across all of
 * them anyway. It is therefore stricter than any surface really is, which is
 * the only direction a contrast guard may be wrong in, and it is cheap: the
 * ink ramp still clears the floor against the combined stack, so nothing is
 * lost by not splitting it per variant.
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
 *
 * `--accent` does NOT clear 4.5:1 here (3.34:1 light, 4.44:1 dark). It is used
 * on this backdrop only for icons, where WCAG 1.4.11's 3:1 applies — never as
 * text. `--ink-muted` does not clear it either; see the guard.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { findColorLiterals, type Rgba } from "./color-literals";
import { readThemeTokens, resolveToken, type ThemeName } from "./tokens";

export const DEPTH_PATH = join(
  process.cwd(),
  "src/components/gradient-depth.tsx"
);

const OPAQUE_HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Ceiling on the layer count the corner enumeration will attempt. The shell
 * paints four; this exists so that a file which somehow grows dozens fails
 * loudly rather than through a wrapped bit shift. See the throw in
 * `compositeMeshCorners`.
 */
const MAX_LAYERS = 20;

/**
 * The Tailwind palette entries the depth layers name. Tailwind's
 * values, not ours, so this is a lookup rather than a decision — and an
 * unknown one THROWS rather than being skipped, because a layer this module
 * silently dropped would make the "worst case" quietly too flattering, which
 * is the exact failure mode the whole file exists to prevent.
 */
const TAILWIND: Record<string, string> = {
  // TAILWIND v4 VALUES, NOT v3's. These were wrong until v0.110.0: the map
  // held the familiar v3 hexes (#10b981, #3b82f6), but v4 ships this palette
  // in oklch and those convert to visibly different sRGB — emerald-500 is
  // oklch(69.6% 0.17 162.48) = #00bc7d, not #10b981. Every composite this
  // module produced was therefore computed from colours the browser does not
  // paint. Kept as hex rather than oklch because color-literals.ts
  // deliberately refuses to gamut-map oklch, and a wrong-but-parseable value
  // is exactly what this comment exists to stop happening twice.
  "emerald-500": "#00bc7d", // oklch(69.6% 0.17 162.48)
  "blue-500": "#2b7fff", // oklch(62.3% 0.214 259.815)
  "indigo-500": "#615fff", // oklch(58.5% 0.233 277.117)
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
 * Every blurred depth blob, read as Tailwind utilities out of
 * `gradient-depth.tsx`.
 *
 * That file exists to BE this scan's input. It used to read `app-shell.tsx`,
 * which worked only because the shell is small and paints nothing else; the
 * login page paints its own blobs too, and scanning a page picked up button
 * hover fills and card grounds along with them. One component now owns every
 * depth layer in the app, so the scan has a well-defined source and neither
 * surface can add a layer nothing measures.
 *
 * The whole file is scanned rather than one variant: including more layers
 * only makes the bound STRICTER, which is the safe direction. `blur-[…]`
 * spreads a blob without capping its alpha, so peak alpha stays reachable and
 * the peak is what is used.
 */
function shellBlobLayers(source: string): MeshLayer[] {
  const out: MeshLayer[] = [];
  // Every `bg-…` utility, matched loosely on purpose. The narrow form of this
  // regex (colour name + bare-digit alpha) silently DROPPED every other
  // spelling — a bracketed alpha, an arbitrary `bg-[#1e293b]` value, an opaque
  // `bg-emerald-500` with no alpha at all — while the unknown-colour branch
  // below threw, for exactly the reason a drop is worse: a depth layer left
  // out makes the worst case look better than the page. Recognising the
  // utility first and refusing what cannot be reduced handles both the same
  // way.
  //
  // (The dropped spellings are described rather than written out: this file is
  // inside the tree tests/type-scale-guard.test.ts scans, and spelling one in
  // a comment counts as an offender against its ratchet — which is how this
  // very paragraph was caught.)
  for (const m of source.matchAll(
    /\bbg-(\[[^\]]+\]|[a-z]+(?:-\d{2,3})?)(?:\/(\[[^\]]+\]|\d{1,3}))?\b/g
  )) {
    const [text, name, alpha] = m;
    // Tailwind's own layout/state utilities share the bg- prefix in spirit but
    // not in grammar; anything that is not a colour we can name is refused
    // rather than skipped.
    const hex = name.startsWith("[") ? name.slice(1, -1) : TAILWIND[name];
    if (!hex || !OPAQUE_HEX.test(hex)) {
      throw new Error(
        `mesh-composite: gradient-depth.tsx paints ${text}, and this module cannot ` +
          `reduce "${name}" to a colour. Add it to the Tailwind lookup, or ` +
          `express it as a hex — a depth layer left out of the composite ` +
          `makes the worst case look better than the page, which is the one ` +
          `direction this guard must never be wrong in.`
      );
    }
    const a =
      alpha === undefined
        ? 1
        : alpha.startsWith("[")
          ? Number(alpha.slice(1, -1))
          : Number(alpha) / 100;
    if (!Number.isFinite(a)) {
      throw new Error(
        `mesh-composite: gradient-depth.tsx paints ${text} and its alpha ` +
          `"${alpha}" is not a number this module can use.`
      );
    }
    out.push({
      source: `depth ${text}`,
      text,
      rgba: [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
        a,
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
  shellSource: string = readFileSync(DEPTH_PATH, "utf8")
): MeshComposite[] {
  const base = surfaceBase(css, theme);
  const all = [...meshBloomLayers(css), ...shellBlobLayers(shellSource)];
  // 2^n corners: fine for the four layers that exist, and this is where that
  // stops being true. `1 << 31` is negative and `1 << 32` is 1 in JS, either of
  // which would quietly reduce the enumeration to nothing or to the bare
  // surface and let every ratio pass for the wrong reason. Refuse instead —
  // and well before then, since 20 layers is already a million corners.
  if (all.length > MAX_LAYERS) {
    throw new Error(
      `mesh-composite: ${all.length} layers is more than this module will ` +
        `enumerate (${MAX_LAYERS}). It walks 2^n corners of the alpha box, so ` +
        `the cost doubles per layer and the bit shift itself breaks at 31. ` +
        `If the shell really does paint this many, the worst case needs a ` +
        `different derivation, not a bigger loop.`
    );
  }
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
  shellSource: string = readFileSync(DEPTH_PATH, "utf8")
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

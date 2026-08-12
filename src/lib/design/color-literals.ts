/**
 * Finds and classifies raw colour literals in a string of CSS (a declaration
 * value, or the object body of a JSX `style={{ … }}`).
 *
 * WHY THIS EXISTS — the guard hole it closes (C1, whole-branch review
 * 2026-08-11): the first version of the globals.css scan in
 * tests/type-scale-guard.test.ts enumerated *spellings* — two hand-written
 * `rgba()` patterns plus the literal hex values of the ink/surface tokens.
 * Every one of `rgb(255 255 255 / 40%)`, `#ffffff66`, `hsl(0 0% 100%)`,
 * `color-mix(in srgb, white 40%, transparent)` and the bare keyword `white`
 * walked straight through it. A guard that has to be taught each new syntax
 * is a guard that is silently out of date the moment CSS Color 4 lands
 * another function.
 *
 * SO THE SHAPE IS INVERTED. Instead of enumerating the syntaxes that are
 * forbidden, this module recognises *that a colour literal is present at
 * all* — by the closed grammar CSS gives colours:
 *
 *   1. `#` followed by 3, 4, 6 or 8 hex digits (so 8-digit alpha hex is not
 *      a special case, it is the same case);
 *   2. a call to one of CSS Color 4/5's colour functions, matched by
 *      FUNCTION NAME, so every argument spelling — legacy comma, modern
 *      space-and-slash, percentages, `none` — is covered by construction;
 *   3. a colour keyword.
 *
 * and then decides what the literal MEANS rather than how it was written:
 * `parse()` reduces the parseable forms to RGBA so a caller can ask the only
 * two questions that matter — "is it neutral (ink/surface) or chromatic
 * (brand)?" and "what does it composite to over this surface?". Anything in
 * the grammar that cannot be reduced (`oklch()`, `color-mix()`, …) is
 * returned with `rgba: null`, which callers treat as an offender: a raw
 * colour nobody can evaluate is exactly the thing that belongs behind a
 * token.
 *
 * Deliberately NOT a CSS colour engine. It does not resolve `color-mix()`,
 * gamut-map `oklch()`, or honour `@media (color-gamut)`. It answers one
 * question — "is there a raw colour here, and if so roughly what is it" —
 * which is all a source guard can honestly claim.
 */

/**
 * CSS Color 4/5 colour functions, by name. Anything that produces a colour
 * and takes parentheses belongs here; matching the NAME rather than the
 * argument grammar is what makes new argument syntaxes free.
 */
const COLOR_FUNCTIONS = [
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color-mix",
  "color-contrast",
  "device-cmyk",
  "light-dark",
  "color",
] as const;

/**
 * The CSS colour keywords whose channels sit within NEUTRAL_TOLERANCE of one
 * another — i.e. the keywords that name an ink or a surface rather than a
 * brand colour. This is a closed subset of a fixed spec list, filtered by
 * the same neutrality rule `isNeutral()` applies to every other syntax, not
 * a list of "spellings we remembered": every other CSS keyword is chromatic,
 * and chromatic literals are out of the ink/surface guard's scope by the
 * same rule that puts `#10b981` out of scope.
 */
const NEUTRAL_KEYWORDS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  dimgray: "#696969",
  dimgrey: "#696969",
  darkgray: "#a9a9a9",
  darkgrey: "#a9a9a9",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  gainsboro: "#dcdcdc",
  whitesmoke: "#f5f5f5",
  snow: "#fffafa", // spread 5
  ghostwhite: "#f8f8ff", // spread 7
  mintcream: "#f5fffa", // spread 10
};

/**
 * Keywords that are colour-valued but carry no colour of their own, so they
 * cannot be theme-blind and cannot fail a contrast ratio: `transparent`
 * composites to nothing, and `currentColor`/`inherit` take whatever the
 * cascade already decided (which a token upstream governs).
 */
const COLOR_NEUTRAL_KEYWORDS_OK = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "none",
]);

/** Channels within this many 8-bit steps of each other count as neutral. */
export const NEUTRAL_TOLERANCE = 10;

export type Rgba = readonly [number, number, number, number];

export interface ColorLiteral {
  /** Exactly as written, e.g. `rgb(255 255 255 / 40%)`. */
  readonly text: string;
  /** Offset of `text` within the scanned string. */
  readonly index: number;
  /**
   * The literal reduced to RGBA, or null when it is a colour this module
   * deliberately refuses to guess at (`oklch()`, `color-mix()`, …). Callers
   * treat null as an offender rather than as "probably fine".
   */
  readonly rgba: Rgba | null;
}

function hexToRgba(hex: string): Rgba | null {
  const h = hex.slice(1);
  const expand = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);
  if (h.length === 3 || h.length === 4) {
    return [
      expand(h[0]),
      expand(h[1]),
      expand(h[2]),
      h.length === 4 ? expand(h[3]) / 255 : 1,
    ];
  }
  if (h.length === 6 || h.length === 8) {
    return [
      expand(h.slice(0, 2)),
      expand(h.slice(2, 4)),
      expand(h.slice(4, 6)),
      h.length === 8 ? expand(h.slice(6, 8)) / 255 : 1,
    ];
  }
  return null;
}

/** `40%` → 0.4, `0.4` → 0.4, `none` → 0. */
function number(part: string, scale: number): number | null {
  const t = part.trim();
  if (t === "none") return 0;
  const pct = t.endsWith("%");
  const n = Number.parseFloat(pct ? t.slice(0, -1) : t);
  if (!Number.isFinite(n)) return null;
  return pct ? (n / 100) * scale : n;
}

/**
 * Splits a colour function's argument list on commas and/or whitespace and
 * the modern alpha slash, so `rgb(255 255 255 / 40%)`, `rgba(255,255,255,.4)`
 * and `rgb(255 255 255)` all reduce to the same parts. This is the whole
 * reason a syntax-agnostic guard is possible.
 */
function args(inside: string): string[] {
  return inside
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
}

function hueToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/**
 * Reduces the parseable colour syntaxes to RGBA. Returns null for the ones
 * this module refuses to guess at — see the file header.
 */
export function parseColor(text: string): Rgba | null {
  const t = text.trim();
  if (t.startsWith("#")) return hexToRgba(t);

  const lower = t.toLowerCase();
  const keyword = NEUTRAL_KEYWORDS[lower];
  if (keyword) return hexToRgba(keyword);
  if (COLOR_NEUTRAL_KEYWORDS_OK.has(lower)) return [0, 0, 0, 0];

  const call = /^([a-z-]+)\(([\s\S]*)\)$/i.exec(t);
  if (!call) return null;
  const fn = call[1].toLowerCase();
  const parts = args(call[2]);

  if (fn === "rgb" || fn === "rgba") {
    if (parts.length < 3) return null;
    const [r, g, b] = [
      number(parts[0], 255),
      number(parts[1], 255),
      number(parts[2], 255),
    ];
    const a = parts.length > 3 ? number(parts[3], 1) : 1;
    if (r === null || g === null || b === null || a === null) return null;
    return [Math.round(r), Math.round(g), Math.round(b), a];
  }
  if (fn === "hsl" || fn === "hsla") {
    if (parts.length < 3) return null;
    const h = number(parts[0], 1);
    const s = number(parts[1], 1);
    const l = number(parts[2], 1);
    const a = parts.length > 3 ? number(parts[3], 1) : 1;
    if (h === null || s === null || l === null || a === null) return null;
    const [r, g, b] = hueToRgb(h, s, l);
    return [r, g, b, a];
  }
  return null;
}

/** The regex the scanner uses. Built from the grammar above, not from spellings. */
const LITERAL = new RegExp(
  [
    // #rgb / #rgba / #rrggbb / #rrggbbaa
    "#[0-9a-fA-F]{3,8}\\b",
    // a colour function call, matched by name; one level of nested parens is
    // enough for every real value (`color-mix(in srgb, var(--a) 8%, …)`).
    `\\b(?:${COLOR_FUNCTIONS.join("|")})\\((?:[^()]|\\([^()]*\\))*\\)`,
    // a neutral colour keyword. The colour-valued keywords that carry no
    // colour (`transparent`, `currentColor`, `none`, …) are deliberately not
    // matched: they cannot be theme-blind and cannot fail a ratio, so
    // surfacing them would only add noise to every caller's inventory.
    `\\b(?:${Object.keys(NEUTRAL_KEYWORDS).join("|")})\\b`,
  ].join("|"),
  "gi"
);

/**
 * Every colour literal in `value`. Custom-property *references* are stripped
 * first (`var(--ink-muted)` is the opposite of an offender), but a var()
 * FALLBACK is not — `var(--x, #fff)` still ships that hex.
 */
export function findColorLiterals(value: string): ColorLiteral[] {
  // Blank out `--token-name` identifiers, preserving offsets, so a token
  // whose own name contains a colour keyword (`--chat-bubble-white`) cannot
  // masquerade as a literal.
  const scannable = value.replace(/--[a-zA-Z0-9_-]+/g, (m) =>
    " ".repeat(m.length)
  );
  const out: ColorLiteral[] = [];
  for (const m of scannable.matchAll(LITERAL)) {
    out.push({
      text: m[0],
      index: m.index,
      rgba: parseColor(m[0]),
    });
  }
  return out;
}

/**
 * True when a literal names an ink or a surface rather than a brand colour —
 * the scope tests/type-scale-guard.test.ts's globals.css assertion is
 * deliberately limited to. Derived from the colour itself (achromatic within
 * NEUTRAL_TOLERANCE), so it holds for every syntax, including ones nobody
 * has written yet. A fully transparent literal is nobody's ink.
 */
export function isNeutral(rgba: Rgba): boolean {
  const [r, g, b, a] = rgba;
  if (a === 0) return false;
  return Math.max(r, g, b) - Math.min(r, g, b) <= NEUTRAL_TOLERANCE;
}

/** Alpha-composites `fg` over an opaque `#rrggbb`, returning `#rrggbb`. */
export function compositeOver(fg: Rgba, backgroundHex: string): string {
  const bg = hexToRgba(backgroundHex);
  if (!bg)
    throw new Error(`compositeOver: not an opaque hex: ${backgroundHex}`);
  const a = fg[3];
  const mix = (f: number, b: number) => Math.round(f * a + b * (1 - a));
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(mix(fg[0], bg[0]))}${hex(mix(fg[1], bg[1]))}${hex(mix(fg[2], bg[2]))}`;
}

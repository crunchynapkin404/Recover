/**
 * Extracts the declarations of JSX `style={{ … }}` object literals out of
 * source text, so a guard can judge the colours in them.
 *
 * WHY THIS EXISTS — the guard hole it closes (C2, whole-branch review
 * 2026-08-11): tests/type-scale-guard.test.ts scanned src/**\/*.tsx for
 * Tailwind utilities and globals.css for raw CSS, and claimed between them
 * that "anything that can reach the screen is findable by scanning". An
 * inline `style={{ color: "rgba(255,255,255,0.4)" }}` reaches the screen
 * through neither. src/components/train/fitness-tiles.tsx painted its context
 * labels at 3.77:1 — the exact value `.label-micro` was fixed from — while
 * every assertion in that file passed, in a file the scan already opened and
 * read.
 *
 * WHY A LEXICAL SCAN RATHER THAN THE TYPESCRIPT AST: the question this
 * answers is "which colour literals are written in an inline style, and on
 * what property" — a question about the source text, not about types. The
 * repo has no AST dependency and this release may not add a runtime one. The
 * cost is honest and bounded: the scan understands the shape
 * `style={{ prop: <expression> }}`, and every OTHER shape a style prop can
 * take (`style={someObject}`, a spread) is reported as `kind: "opaque"`
 * rather than silently skipped — so the set of things it cannot see is itself
 * enumerable, which is the property the old comment claimed and did not have.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: resolve expressions. `color: t.color` and
 * `color: rgb(${style.hue})` name colours this module cannot evaluate, and it
 * says so (empty `literals`, non-empty `interpolated`, or neither) instead of
 * guessing. The caller records those in an inventory that cannot grow, which
 * is what a source scan can honestly offer for a value assembled at runtime.
 */
import { findColorLiterals, type ColorLiteral } from "./color-literals";

/**
 * What an inline style property is FOR, derived from its NAME — the same
 * shape as tokens.ts's roleOfToken, and for the same reason: a rule about
 * names holds for properties nobody has written yet.
 *
 *   - "text"     — the declaration paints TEXT. Carries the AA text floor.
 *   - "non-text" — the declaration paints a fill, an edge, a shadow or an SVG
 *                  shape. Inventoried, but no single ratio applies to it.
 *   - null       — not colour-valued at all (`height`, `transform`, …).
 */
export type StyleRole = "text" | "non-text";

/**
 * Properties that paint text. `color` is the one in use today; the rest are
 * the other ways CSS lets a declaration set the colour of glyphs, listed so
 * that reaching for one of them does not silently escape the floor.
 */
const TEXT_PROPERTIES = new Set([
  "color",
  "webkittextfillcolor",
  "textfillcolor",
  "textdecorationcolor",
  "textemphasiscolor",
]);

/**
 * Colour-bearing properties that are not `*color`: shorthands and SVG
 * presentation attributes. `fill`/`stroke` on an SVG <text> do paint glyphs,
 * but every inline use in this app paints a shape, so they are inventoried as
 * non-text; a fill that is text is a case for the axe pass, which reads the
 * rendered DOM rather than the source.
 */
const COLOR_BEARING = new Set([
  "background",
  "backgroundimage",
  "border",
  "bordertop",
  "borderright",
  "borderbottom",
  "borderleft",
  "outline",
  "boxshadow",
  "textshadow",
  "fill",
  "stroke",
  "caret",
]);

/** `"backgroundColor"` / `"background-color"` / `backgroundColor` → `backgroundcolor`. */
function normalizeProperty(property: string): string {
  return property
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/-/g, "")
    .toLowerCase();
}

export function propertyRole(property: string): StyleRole | null {
  // A custom property set inline (`style={{ "--x": … }}`) has no known use
  // site — the CSS that consumes it decides whether it lands on text — so it
  // is recorded, never floored.
  if (property.replace(/^["'`]/, "").startsWith("--")) {
    return /colou?r/i.test(property) ? "non-text" : null;
  }
  const n = normalizeProperty(property);
  if (TEXT_PROPERTIES.has(n)) return "text";
  if (COLOR_BEARING.has(n) || /colou?r$/.test(n)) return "non-text";
  return null;
}

export type InlineStyleEntry =
  | {
      kind: "declaration";
      /** As written, e.g. `backgroundColor` or `"--ring"`. */
      property: string;
      /** The value expression as written, with runs of whitespace collapsed. */
      value: string;
      /** 1-indexed line of the property in the source. */
      line: number;
    }
  | {
      /**
       * A `style=` prop whose value is not an inline object literal, so its
       * declarations are not in the source at this point at all. Reported so
       * that this scan's blind spot is enumerable rather than invisible.
       */
      kind: "opaque";
      value: string;
      line: number;
    };

/**
 * Index of the string/template literal's closing quote, honouring escapes and
 * — for templates — `${ … }` interpolations, which may themselves contain
 * braces, strings and further templates.
 */
function skipString(src: string, start: number): number {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (quote === "`" && c === "$" && src[i + 1] === "{") {
      const close = matchBrace(src, i + 1);
      if (close === -1) return src.length;
      i = close;
      continue;
    }
    if (c === quote) return i;
  }
  return src.length;
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Offsets of the top-level commas of an object body, in order. */
function topLevelSplits(body: string): number[] {
  const cuts: number[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(body, i);
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) cuts.push(i);
  }
  return cuts;
}

/** Offset of the `:` separating an object entry's key from its value, or -1. */
function keySeparator(entry: string): number {
  let depth = 0;
  for (let i = 0; i < entry.length; i++) {
    const c = entry[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(entry, i);
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === ":" && depth === 0) return i;
  }
  return -1;
}

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");
const lineOf = (source: string, offset: number) =>
  source.slice(0, offset).split("\n").length;

/**
 * Characters a trailing `//` comment can legitimately follow. Nothing else on
 * the line, or one of these, and it is a comment; anything else — a letter, a
 * digit — and it is JSX text such as `and/or`, which must NOT be blanked to
 * end of line, because doing so could swallow a real style prop written after
 * it. Biased that way on purpose: a comment this misses can only ever add a
 * false offender (loud, fixable), while a style prop swallowed by an
 * over-eager mask is silent.
 */
const LINE_COMMENT_MAY_FOLLOW = new Set([
  ";",
  ",",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  "=",
  ">",
  "*",
  '"',
  "'",
  "`",
]);

function startsLineComment(source: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && (source[i] === " " || source[i] === "\t")) i--;
  return i < 0 || source[i] === "\n" || LINE_COMMENT_MAY_FOLLOW.has(source[i]);
}

/**
 * Blanks every comment, character by character with newlines preserved, so
 * offsets and line numbers still match the real file.
 *
 * REQUIRED, not tidiness — and the same lesson tests/type-scale-guard.test.ts
 * learned for globals.css: a guard's own doc comments quote the offending
 * values they exist to describe. This module's header quotes an inline
 * rgba(255,255,255,0.4), and the first run of the guard duly reported the
 * documentation as a sub-AA defect.
 */
export function maskComments(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    // A stray apostrophe in JSX text ("don't") makes this skip too far. That
    // costs a missed comment mask — a false offender — never a missed style
    // prop, since masking only ever blanks a comment it has found.
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i);
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const to = end === -1 ? source.length : end + 2;
      blank(i, to);
      i = to - 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/" && startsLineComment(source, i)) {
      const nl = source.indexOf("\n", i);
      const to = nl === -1 ? source.length : nl;
      blank(i, to);
      i = to - 1;
    }
  }
  return out.join("");
}

/**
 * Every `style=` prop in `source`, as declarations where the value is an
 * inline object literal and as a single `opaque` entry where it is not.
 */
export function findInlineStyleEntries(raw: string): InlineStyleEntry[] {
  const source = maskComments(raw);
  const entries: InlineStyleEntry[] = [];
  for (const m of source.matchAll(/\bstyle\s*=\s*\{/g)) {
    const outerOpen = m.index + m[0].length - 1;
    const outerClose = matchBrace(source, outerOpen);
    if (outerClose === -1) continue;
    const inner = source.slice(outerOpen + 1).search(/\S/);
    const objectOpen = outerOpen + 1 + inner;
    if (inner === -1 || source[objectOpen] !== "{") {
      entries.push({
        kind: "opaque",
        value: collapse(source.slice(outerOpen + 1, outerClose)),
        line: lineOf(source, outerOpen),
      });
      continue;
    }
    const objectClose = matchBrace(source, objectOpen);
    if (objectClose === -1) continue;
    const body = source.slice(objectOpen + 1, objectClose);
    const bounds = [-1, ...topLevelSplits(body), body.length];
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i] + 1;
      const raw = body.slice(start, bounds[i + 1]);
      if (!raw.trim() || raw.trim().startsWith("...")) continue;
      const sep = keySeparator(raw);
      const keyOffset = start + raw.search(/\S/);
      const line = lineOf(source, objectOpen + 1 + keyOffset);
      // Shorthand (`{ color }`) still NAMES its property — the value is the
      // identifier, which is a runtime value like any other expression. Only
      // a computed key or something unparseable is genuinely opaque.
      if (sep === -1) {
        const shorthand = collapse(raw);
        entries.push(
          /^[A-Za-z_$][\w$]*$/.test(shorthand)
            ? {
                kind: "declaration",
                property: shorthand,
                value: shorthand,
                line,
              }
            : { kind: "opaque", value: shorthand, line }
        );
        continue;
      }
      entries.push({
        kind: "declaration",
        property: raw.slice(0, sep).trim(),
        value: collapse(raw.slice(sep + 1)),
        line,
      });
    }
  }
  return entries;
}

export interface StyleValueColors {
  /** Colour literals written out in full — evaluable, and therefore floorable. */
  literals: ColorLiteral[];
  /**
   * Colour syntax whose channels come out of a `${ … }` interpolation, e.g.
   * `` `rgb(${style.hue})` ``. A source scan cannot know what it renders as;
   * the caller inventories these instead of guessing.
   */
  interpolated: string[];
  /** `var(--token)` references, by token name — the opposite of an offender. */
  tokens: string[];
}

/**
 * Splits a style value's colours into the three cases a source scan can
 * honestly distinguish. `findColorLiterals` does the recognising, so every
 * syntax it learns (see its header — the grammar, not a spelling list) is
 * learned here too.
 */
export function styleValueColors(value: string): StyleValueColors {
  const spans: [number, number][] = [];
  for (const m of value.matchAll(/\$\{/g)) {
    const close = matchBrace(value, m.index + 1);
    spans.push([m.index, close === -1 ? value.length : close]);
  }
  const literals: ColorLiteral[] = [];
  const interpolated: string[] = [];
  for (const literal of findColorLiterals(value)) {
    const end = literal.index + literal.text.length;
    const touchesInterpolation = spans.some(
      ([from, to]) => from < end && to >= literal.index
    );
    if (touchesInterpolation) interpolated.push(literal.text);
    else literals.push(literal);
  }
  return {
    literals,
    interpolated,
    tokens: [...value.matchAll(/var\(\s*--([\w-]+)/g)].map((m) => m[1]),
  };
}

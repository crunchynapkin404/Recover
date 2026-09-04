/**
 * Reads the design tokens out of the CSS that actually ships. The guards
 * assert against this file rather than a duplicated table, so a token
 * changed in CSS cannot pass a test that was checking a copy.
 *
 * WHY THIS FILE WAS REWRITTEN (C1/I6, whole-branch review 2026-08-11): the
 * first version had two holes, both of the same kind — a guard that appears
 * to cover a class and does not.
 *
 *  1. `extractBlock` used a NON-GLOBAL regex, so it read only the FIRST
 *     `:root` and the FIRST `.dark` block. globals.css has six. The glass /
 *     login-input / chat-bubble tokens and the entire `--viz-*` palette —
 *     including chart TEXT — were governed by nothing, and
 *     tests/type-scale-guard.test.ts masked all six blocks before scanning
 *     for raw colour on the strength of a coverage claim that was false.
 *     Restoring `--viz-muted-ink: rgba(255,255,255,0.3)` (~2.7:1, the value
 *     this release exists to eliminate) passed 34/34.
 *  2. A hand-written `GOVERNED` array decided what got checked, and the
 *     contrast guard's own remediation message told you to add new tokens to
 *     it — while the ratios were actually asserted from two *other*
 *     hand-written arrays. Following the instruction did not get a token
 *     checked: `--ink-hint: #b0b0b0` (2.17:1 on white — the review's own
 *     figure of 1.94:1 does not reproduce) added to the CSS and
 *     to GOVERNED still passed, and the test count did not even move.
 *
 * SO NOTHING HERE IS A LIST OF TOKENS ANY MORE. The inventory is read from
 * the CSS — every `:root`/`.dark` block, every declaration — and what each
 * token is FOR is derived from its name (`roleOfToken`). Add a token to any
 * block and it is checked, or the guard fails telling you to give it a role.
 * The remediation instruction and the mechanism are now the same thing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CSS_PATH = join(process.cwd(), "src/app/globals.css");
export const THEME_PROVIDER_PATH = join(
  process.cwd(),
  "src/components/theme-provider.tsx"
);

export type ThemeName = "light" | "dark";

/** `:root` is the light theme; `.dark` is the dark theme. */
const THEME_OF: Record<string, ThemeName> = {
  ":root": "light",
  ".dark": "dark",
};

export interface ThemeBlock {
  selector: ":root" | ".dark";
  theme: ThemeName;
  /** Everything between the braces. */
  body: string;
  /** 1-indexed line of the selector, for guard messages. */
  line: number;
}

/**
 * EVERY `:root { … }` / `.dark { … }` block in the file, in source order —
 * the global-regex fix for hole (1) above. Matches at the start of a line up
 * to the first closing brace in column 0, the formatting Prettier enforces
 * on this file.
 */
export function extractThemeBlocks(css: string): ThemeBlock[] {
  const re = /^(:root|\.dark)\s*\{([\s\S]*?)^\}/gm;
  const blocks: ThemeBlock[] = [];
  for (const m of css.matchAll(re)) {
    blocks.push({
      selector: m[1] as ":root" | ".dark",
      theme: THEME_OF[m[1]],
      body: m[2],
      line: css.slice(0, m.index).split("\n").length,
    });
  }
  for (const theme of ["light", "dark"] as const) {
    if (!blocks.some((b) => b.theme === theme)) {
      throw new Error(`tokens: no ${theme} theme block in globals.css`);
    }
  }
  return blocks;
}

/**
 * The themes the athlete's app can actually render, read from the provider
 * that decides it rather than from a comment.
 *
 * BOTH THEMES ARE REACHABLE. `forcedTheme` was lifted in v0.111.0 and the
 * athlete chooses light, dark or system, so a hardcoded dark-only colour CAN
 * now be seen failing in light. Until 2026-09-04 this comment still said
 * `forcedTheme="dark"` means "the light palette ships but is unreachable
 * outside the screenshot script", which theme-provider.tsx has contradicted
 * in bold since v0.111.0. The function below never depended on that being
 * true — it reads the provider — so only the prose was wrong.
 *
 * FAILS CLOSED, DELIBERATELY: anything other than a literal `forcedTheme` of
 * a known theme name — the attribute removed at slice 9, or made dynamic —
 * returns BOTH themes, which is what makes the theme-blind literals in the
 * inventory (race-chip, coach-brief, day-actions) start failing the inline
 * AA floor the moment light mode becomes reachable. That is the correct
 * moment for them to fail, and nobody has to remember to widen this.
 */
export function renderableThemes(
  source = readFileSync(THEME_PROVIDER_PATH, "utf8")
): ThemeName[] {
  const forced = /forcedTheme\s*=\s*"(light|dark)"/.exec(source);
  return forced ? [forced[1] as ThemeName] : ["light", "dark"];
}

export interface TokenDeclaration {
  token: string;
  /** Exactly as written, e.g. `var(--ink-muted)` or `rgba(255, 255, 255, 0.05)`. */
  value: string;
  theme: ThemeName;
  selector: ":root" | ".dark";
  /** 1-indexed line in globals.css. */
  line: number;
}

function readCss(): string {
  return readFileSync(CSS_PATH, "utf8");
}

/** Every custom-property declaration in every theme block, in source order. */
export function readDeclarations(css = readCss()): TokenDeclaration[] {
  const out: TokenDeclaration[] = [];
  for (const block of extractThemeBlocks(css)) {
    for (const m of block.body.matchAll(/^[ \t]*--([\w-]+)\s*:\s*([^;]+);/gm)) {
      out.push({
        token: m[1],
        value: m[2].trim(),
        theme: block.theme,
        selector: block.selector,
        line: block.line + block.body.slice(0, m.index).split("\n").length - 1,
      });
    }
  }
  return out;
}

/**
 * The seven `--text-*` type-scale tokens, read out of the `@theme inline {
 * … }` block and resolved to px — the C1 fix (whole-branch review
 * 2026-08-12). `extractThemeBlocks` above deliberately matches only
 * `:root`/`.dark`; `@theme inline` is Tailwind's own block and a different
 * selector, so nothing upstream of this function ever saw it. Before this,
 * `tests/type-scale-guard.test.ts` held a hand-copied `SCALE_PX` literal —
 * changing `--text-label` in the CSS could not turn that test red, because
 * nothing read the CSS. This reads it.
 *
 * FAILS LOUDLY on a `--text-*` declaration it cannot resolve to px (not a
 * bare `px` or `rem` value) rather than omitting it — an unresolvable scale
 * token is exactly the kind of drift this function exists to catch, so it
 * must not silently vanish into an `undefined` a caller might not check.
 */
export function readScaleTokens(css: string): Record<string, number> {
  const blockRe = /^@theme\s+inline\s*\{([\s\S]*?)^\}/m;
  const block = blockRe.exec(css);
  if (!block) {
    throw new Error(
      "tokens: no `@theme inline { … }` block in globals.css — the type " +
        "scale lives there and this reader would find nothing"
    );
  }
  const blockLine = css.slice(0, block.index).split("\n").length;
  const body = block[1];
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/^[ \t]*(--text-[\w-]+)\s*:\s*([^;]+);/gm)) {
    const token = m[1];
    // `--text-<step>--line-height` companions are Tailwind's pairing
    // convention, not size steps: they are unitless ratios, so the px
    // resolution below cannot apply and the 12px floor has nothing to say
    // about them. Skipped by NAME rather than by failing to parse, so a real
    // size token written in a unit this cannot read still throws.
    //
    // NARROWING A GUARD IS HOW GUARDS GET HOLLOWED OUT, so note what still
    // covers these: tests/motion-scale-guard.test.ts asserts every step has a
    // companion and that the display steps are tighter than the body steps.
    // They are checked, just not here.
    if (token.endsWith("--line-height")) continue;
    const raw = m[2].trim();
    const line = blockLine + body.slice(0, m.index).split("\n").length - 1;
    const px = /^([\d.]+)px$/.test(raw)
      ? Number(/^([\d.]+)px$/.exec(raw)![1])
      : /^([\d.]+)rem$/.test(raw)
        ? Number(/^([\d.]+)rem$/.exec(raw)![1]) * 16
        : null;
    if (px == null) {
      throw new Error(
        `tokens: ${token} at globals.css:${line} is "${raw}", which is ` +
          `neither a bare px nor rem value — readScaleTokens cannot resolve ` +
          `it to a pixel size, and a scale token this guard can't measure is ` +
          `not a token the 12px floor is actually checking`
      );
    }
    out[token] = px;
  }
  if (Object.keys(out).length === 0) {
    throw new Error(
      "tokens: no --text-* declarations found inside @theme inline { … } — " +
        "the type scale moved or was renamed and this reader is now blind"
    );
  }
  return out;
}

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

export type ThemeTokens = Record<string, string>;

/**
 * The token map each theme actually renders with, following the real cascade
 * rather than the file's layout: the dark theme is `<html class="dark">`,
 * which is *also* `:root`, so every `:root` declaration applies in dark too
 * and `.dark` (higher specificity) overrides it. That is why `--viz-series-1`
 * is a real dark-mode token despite being declared only under `:root`, and
 * why the old per-block "`.dark` is missing --x" error was wrong about the
 * cascade as well as blind to five of six blocks.
 */
export function readThemeTokens(
  css = readCss()
): Record<ThemeName, ThemeTokens> {
  const declarations = readDeclarations(css);
  const light: ThemeTokens = {};
  for (const d of declarations)
    if (d.theme === "light") light[d.token] = d.value;
  const dark: ThemeTokens = { ...light };
  for (const d of declarations) if (d.theme === "dark") dark[d.token] = d.value;
  return { light, dark };
}

/**
 * Follows a pure `var(--other)` / `var(--other, fallback)` alias chain to the
 * literal it ends at. A value that merely *contains* a var() among other
 * things (`calc(var(--radius) * 0.6)`) is returned as written — it is not an
 * alias. Returns null on a dangling or cyclic reference.
 */
export function resolveToken(
  tokens: ThemeTokens,
  token: string,
  seen: readonly string[] = []
): { value: string; chain: readonly string[] } | null {
  if (seen.includes(token)) return null;
  const raw = tokens[token];
  if (raw === undefined) return null;
  const alias = /^var\(\s*--([\w-]+)\s*(?:,[\s\S]*)?\)$/.exec(raw);
  if (!alias) return { value: raw, chain: [...seen, token] };
  return resolveToken(tokens, alias[1], [...seen, token]);
}

/**
 * What a token is FOR, derived from its name:
 *
 *   - "text"     — carries text. Must resolve to an opaque colour and clear
 *                  the AA text floor on every surface in its theme.
 *   - "surface"  — text sits on it. Must resolve to an opaque colour.
 *   - "non-text" — dividers, borders, icon strokes. WCAG 1.4.11's 3:1 floor
 *                  where it is opaque enough to have a single ratio.
 *
 * null means "this name claims nothing", which the contrast guard treats as
 * a failure unless the token is a pure alias to a token that does have a
 * role, or is explicitly waived. That is the fail-closed half: a new token
 * cannot arrive unchecked and unnoticed, whichever block it lands in.
 *
 * The patterns are shapes, not enumerations — `--ink-muted`,
 * `--viz-muted-ink` and a future `--ink-hint` all match the same rule, which
 * is what makes the guard's advice ("name it `*-ink`") true rather than
 * decorative.
 */
export type TokenRole = "text" | "surface" | "non-text";

export function roleOfToken(token: string): TokenRole | null {
  if (/(?:^|-)ink(?:-|$)/.test(token)) return "text";
  if (/^surface(?:-|$)/.test(token)) return "surface";
  // The brand colour is used as text (badges, links, the "+ Add race"
  // summary), so it carries the text floor like any ink.
  if (token === "accent") return "text";
  if (/(?:^|-)(?:hairline|divider|grid|axis)$/.test(token)) return "non-text";
  return null;
}

/** Every theme's tokens with each value resolved through its alias chain. */
export function resolvedThemeTokens(
  css = readCss()
): Record<ThemeName, ThemeTokens> {
  const raw = readThemeTokens(css);
  const out = {} as Record<ThemeName, ThemeTokens>;
  for (const theme of ["light", "dark"] as const) {
    const resolved: ThemeTokens = {};
    for (const token of Object.keys(raw[theme])) {
      const r = resolveToken(raw[theme], token);
      if (r) resolved[token] = r.value;
    }
    out[theme] = resolved;
  }
  return out;
}

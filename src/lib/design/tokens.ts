/**
 * Reads the design tokens out of the CSS that actually ships. The guard
 * asserts against this file rather than a duplicated table, so a token
 * changed in CSS cannot pass a test that was checking a copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CSS_PATH = join(process.cwd(), "src/app/globals.css");

/** Tokens the contrast guard governs. A token not listed here is not checked. */
export const GOVERNED = [
  "surface-base",
  "surface-raised",
  "surface-overlay",
  "ink-primary",
  "ink-secondary",
  "ink-muted",
  "hairline",
  "accent",
] as const;

export type GovernedToken = (typeof GOVERNED)[number];
export type TokenSet = Record<GovernedToken, string>;

function extractBlock(css: string, selector: string): string {
  // Matches `:root {` / `.dark {` at the start of a line, up to the first
  // closing brace in column 0 — the formatting Prettier enforces on this file.
  const re = new RegExp(`^${selector}\\s*\\{([\\s\\S]*?)^\\}`, "m");
  const match = css.match(re);
  if (!match) throw new Error(`tokens: no "${selector}" block in globals.css`);
  return match[1];
}

function parse(block: string, selector: string): TokenSet {
  const out = {} as TokenSet;
  for (const token of GOVERNED) {
    const m = block.match(new RegExp(`--${token}:\\s*([^;]+);`));
    if (!m) throw new Error(`tokens: "${selector}" is missing --${token}`);
    out[token] = m[1].trim();
  }
  return out;
}

export function readTokenSets(): { light: TokenSet; dark: TokenSet } {
  const css = readFileSync(CSS_PATH, "utf8");
  return {
    light: parse(extractBlock(css, ":root"), ":root"),
    dark: parse(extractBlock(css, "\\.dark"), ".dark"),
  };
}

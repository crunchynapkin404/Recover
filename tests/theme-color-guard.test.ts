// tests/theme-color-guard.test.ts
//
// An opaque `text-white` / `bg-black` in a component cannot adapt to a theme.
// It was harmless while this app was dark-only, and stopped being harmless in
// v0.111.0 when `forcedTheme` was removed and ThemeProvider's defaultTheme
// became "system": every such utility became a light-theme defect the moment
// an athlete's OS was in light mode.
//
// One shipped that way. `src/components/ui/inline-markdown.tsx` rendered
// `**bold**` as `font-bold text-white` — a 1:1 contrast ratio in light theme,
// invisible text — on today, today-post-session, today-evening, checkin-sheet
// and debrief-sheet. It survived four releases and was found by the FIRST run
// of .github/workflows/surfaces.yml (run 32368432220), where all 10 confirmed
// defect nodes were that one line.
//
// WHY tests/contrast-guard.test.ts COULD NOT CATCH IT. That guard reads the
// token palette out of the CSS that ships, and is thorough about it — but a
// hardcoded Tailwind utility in a .tsx file is not a token and never reaches
// it. The palette was correct the whole time. This guard covers the other
// half: colours written directly into components, where no token governs them.
//
// Alpha variants (`text-white/60`) are NOT flagged. Those are translucent
// overlays on glass surfaces — they composite against whatever is behind them
// and do adapt. It is the opaque form that cannot.
//
// Comments are stripped before scanning, because the two files that describe
// a colour they no longer use would otherwise fail a correct codebase — the
// same reason tests/release-gate.test.ts strips them.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/** Opaque colour utilities. The `(?![/-])` excludes `-white/60` and `-white-ish`. */
const OPAQUE = /\b(?:text|bg|border)-(?:white|black)(?![/-])/g;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      sourceFiles(p, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    // Test files legitimately assert on class-name literals, including the
    // ones this guard forbids in source — week-day-list.test.tsx uses
    // "font-bold text-white" as a mutation literal on purpose.
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(p);
  }
  return out;
}

describe("theme colour guard", () => {
  it("no component hardcodes an opaque white or black", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const body = stripComments(readFileSync(file, "utf8"));
      for (const line of body.split("\n")) {
        const hits = line.match(OPAQUE);
        if (hits) {
          offenders.push(
            `${file.replace(process.cwd() + "/", "")}: ${hits.join(", ")}`
          );
        }
      }
    }
    expect(
      offenders,
      "These hardcode a colour that cannot follow the theme. Use a token — " +
        "text-foreground, bg-background, border-border — or an alpha variant " +
        "if the intent is a translucent overlay. inline-markdown.tsx shipped " +
        "invisible text in light theme for four releases this way."
    ).toEqual([]);
  });
});

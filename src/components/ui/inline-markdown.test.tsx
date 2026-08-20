import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { InlineMarkdown } from "./inline-markdown";

/**
 * Found by the first CI run of .github/workflows/surfaces.yml (run
 * 32368432220): `**bold**` rendered as `font-bold text-white`, which axe
 * measured at a 1:1 contrast ratio in light theme — invisible text — on
 * today, today-post-session, today-evening, checkin-sheet and debrief-sheet,
 * at both viewports. All 10 of that run's confirmed defect nodes were this
 * one line.
 *
 * It was live rather than latent: `forcedTheme` was removed in v0.111.0 and
 * ThemeProvider's defaultTheme is "system", so any athlete on a light-mode OS
 * saw blank gaps where the coach's emphasis should be.
 *
 * tests/contrast-guard.test.ts could not catch it — that guard reads the CSS
 * token palette, and this was a hardcoded Tailwind utility in TSX. Hence a
 * test here, at the component.
 */
describe("InlineMarkdown", () => {
  it("colours bold with the theme token, not a hardcoded white", () => {
    const html = renderToString(<InlineMarkdown text="Readiness **71**." />);
    expect(html).toContain("text-foreground");
    expect(html).not.toContain("text-white");
  });

  // The whole component, not just <strong>: `code` and `em` carry no colour
  // class at all and inherit, which is correct. This fails if any branch
  // starts hardcoding one.
  it("renders no hardcoded white anywhere", () => {
    const html = renderToString(
      <InlineMarkdown text="**bold** and *italic* and `code` and plain" />
    );
    expect(html).not.toContain("text-white");
    expect(html).not.toContain("#fff");
  });

  it("still renders the emphasis it is there to render", () => {
    const html = renderToString(<InlineMarkdown text="Readiness **71**." />);
    expect(html).toContain("<strong");
    expect(html).toContain("71");
    expect(html).not.toContain("**");
  });
});

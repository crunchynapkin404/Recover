import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { compositeOver } from "@/lib/design/color-literals";
import { contrastRatio } from "@/lib/design/contrast";
import { resolvedThemeTokens } from "@/lib/design/tokens";
import { TodayHero, fmtTsb } from "./today-hero";

const why = {
  hrv: 91,
  hrvBaseline: 97,
  rhr: 52,
  sleepHours: 7.2,
  tsb: -1.94,
};

const base = {
  readiness: 78,
  band: "green" as const,
  recoveryScore: 82,
  sleepScore: 88,
  why,
};

describe("fmtTsb", () => {
  it("uses a real minus sign and one decimal", () => {
    expect(fmtTsb(-1.94)).toBe("−1.9");
    expect(fmtTsb(5.02)).toBe("5.0");
    expect(fmtTsb(0)).toBe("0.0");
  });
});

describe("TodayHero", () => {
  it("renders the score, the verdict and the why line", () => {
    const html = renderToString(<TodayHero {...base} />);
    expect(html).toContain("78");
    expect(html).toContain("Strong");
    expect(html).toContain("HRV 91 vs 97 baseline");
    expect(html).toContain("RHR 52");
    expect(html).toContain("slept 7:12");
    expect(html).toContain("TSB −1.9");
  });

  it("shows a dash and no filled arc while calibrating", () => {
    const html = renderToString(
      <TodayHero {...base} readiness={null} band="calibrating" />
    );
    expect(html).toContain("—");
    expect(html).toContain("Calibrating");
    expect(html).not.toContain("ring-fill");
  });

  it("names the score for screen readers, since the numeral is aria-hidden", () => {
    const html = renderToString(<TodayHero {...base} />);
    expect(html).toContain("Readiness 78");
    const calibrating = renderToString(
      <TodayHero {...base} readiness={null} band="calibrating" />
    );
    expect(calibrating).toContain("Readiness calibrating");
  });

  it("drops a missing signal from the why line rather than inventing it", () => {
    const html = renderToString(
      <TodayHero {...base} why={{ ...why, rhr: null, sleepHours: null }} />
    );
    expect(html).toContain("HRV 91 vs 97 baseline");
    expect(html).not.toContain("RHR");
    expect(html).not.toContain("slept");
  });

  it("reports HRV without a baseline clause when there is no baseline", () => {
    const html = renderToString(
      <TodayHero {...base} why={{ ...why, hrvBaseline: null }} />
    );
    expect(html).toContain("HRV 91");
    expect(html).not.toContain("baseline");
  });

  it("renders both legend figures, and a dash for a missing one", () => {
    const html = renderToString(<TodayHero {...base} sleepScore={null} />);
    // React 19 inserts <!-- --> between adjacent JSX expression children —
    // `{m.label} {m.value}` renders as `Recovery<!-- --> <!-- -->82`, not the
    // literal substring "Recovery 82". src/components/body/body-battery.test.tsx
    // is the house convention for asserting through the marker.
    expect(html).toContain("Recovery<!-- --> <!-- -->82");
    expect(html).toContain("Sleep<!-- --> <!-- -->—");
  });

  it("uses the token type and ink scales", () => {
    const html = renderToString(<TodayHero {...base} />);
    expect(html).toContain("text-figure");
    expect(html).toContain("text-label");
    expect(html).toMatch(/text-ink-(primary|secondary|muted)/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
  });

  // THE CARD NO LONGER VARIES BY TIME OF DAY. It had a "compact" variant the
  // evening and post-session states rendered instead — a half-size ring, no
  // legend — so the app's headline signal shrank as the day went on. One
  // card now, at every hour, in every state.
  it("renders one size — there is no smaller variant to fall back to", () => {
    const html = renderToString(<TodayHero {...base} />);
    expect(html).toContain("w-[104px]");
    expect(html).not.toContain("w-14");
  });

  it("keeps the legend at every hour, because there is only one rendering", () => {
    const html = renderToString(<TodayHero {...base} />);
    expect(html).toContain("Recovery");
    expect(html).toContain("Sleep");
  });

  // Staleness is now a fact about the READING, not about the clock. The old
  // marker fired at 18:00 on a reading taken that same morning, and never
  // fired at 07:00 on a reading three weeks old.
  it("says when a stale reading is from, and drops the advice clause", () => {
    const html = renderToString(<TodayHero {...base} readingAge="Monday" />);
    // React renders the date inside a <span>, so there is no hydration
    // comment between "From " and the word — assert the real output.
    expect(html).toContain("From ");
    expect(html).toContain(">Monday</span>");
    // The one-word verdict survives; the recommendation does not. "ready for
    // intensity" is a claim about a body that was measured days ago.
    expect(html).toContain("Strong");
    expect(html).not.toContain("ready for intensity");
  });

  it("keeps the ring, the why line and the legend on a stale reading", () => {
    const html = renderToString(<TodayHero {...base} readingAge="Monday" />);
    expect(html).toContain("78");
    expect(html).toContain("w-[104px]");
    expect(html).toContain("HRV 91 vs 97 baseline");
    expect(html).toContain("Recovery");
  });

  // The normal case, and the whole point: a reading from today renders the
  // full verdict with nothing added, identically at 07:00 and at 21:00.
  it("adds nothing when the reading is today's", () => {
    const html = renderToString(<TodayHero {...base} readingAge={null} />);
    expect(html).toContain("ready for intensity");
    expect(html).not.toContain("From <span");
  });

  it("still shows an empty track while calibrating", () => {
    const html = renderToString(
      <TodayHero {...base} readiness={null} band="calibrating" />
    );
    expect(html).toContain("<svg");
    expect(html).not.toContain("ring-fill");
    expect(html).toContain("—");
  });

  it("paints the band with token classes, not the dark-only BAND_COLOR map", () => {
    const html = renderToString(<TodayHero {...base} />);
    expect(html).toContain("text-chart-2");
    expect(html).toContain("stroke-chart-2");
    expect(html).not.toContain("#10b981");
  });
});

/**
 * Neither guard covers a band colour used as text: the contrast guard
 * governs tokens by name and waives --chart-*, and the type-scale guard's
 * AA floor reads inline style={{}} only. So assert it here, computed from
 * the shipped CSS with the same helpers the contrast guard uses — never
 * from hexes copied into this file, which is how such a check goes stale.
 *
 * resolvedThemeTokens() returns Record<"light"|"dark", Record<string, string>>
 * keyed by bare token name ("chart-2", "surface-raised", no leading `--`),
 * each value already resolved through its var() alias chain to a literal —
 * see src/lib/design/tokens.ts. contrastRatio() takes two hex colour
 * strings directly (it calls hexToRgb internally via relativeLuminance), so
 * there is no separate hexToRgb call to make here; passing its output into
 * contrastRatio, as a literal reading of the brief's snippet would, is a
 * type error against contrastRatio's real signature — this is the "adapt
 * to what the code actually returns" case the task called out.
 */
describe("band text contrast", () => {
  /**
   * v0.100.1: the hero's surface is `.glass`, not `--surface-raised`, so this
   * measures against the COMPOSITED glass fill — what the band text is really
   * drawn on. In dark the two happen to be identical (5% white over
   * `--surface-base` composites to exactly #161616), but in light they differ,
   * and a test that keeps naming a surface the component stopped using is the
   * "document outliving the code" failure this project keeps re-learning.
   */
  function heroSurface(theme: "light" | "dark"): string {
    const t = resolvedThemeTokens()[theme];
    const m =
      /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)/.exec(
        t["glass-bg"]
      );
    if (!m) return t["glass-bg"]; // an opaque glass fill needs no compositing
    return compositeOver(
      [
        Number(m[1]),
        Number(m[2]),
        Number(m[3]),
        m[4] === undefined ? 1 : Number(m[4]),
      ],
      t["surface-base"]
    );
  }

  it("clears 4.5:1 on the hero's surface in every renderable theme", () => {
    const tokens = resolvedThemeTokens();
    for (const theme of ["light", "dark"] as const) {
      const RAISED = heroSurface(theme);
      for (const token of ["chart-2", "chart-3", "chart-5", "ink-muted"]) {
        const ratio = contrastRatio(tokens[theme][token], RAISED);
        expect(
          ratio,
          `${token} on the hero's glass surface (${RAISED}) in ${theme} is ` +
            `${ratio.toFixed(2)}:1 — a band ` +
            `verdict is text and needs 4.5:1. Either the token moved or the ` +
            `hero's surface did.`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

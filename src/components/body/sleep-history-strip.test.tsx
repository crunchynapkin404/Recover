// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { labelInName } from "@/test/label-in-name";
import { SleepHistoryStrip, type StripNight } from "./sleep-history-strip";

function night(date: string, withStages = true): StripNight {
  return {
    date,
    sleepSecs: 20000,
    sleepDeepSecs: withStages ? 3597 : null,
    sleepRemSecs: withStages ? 4437 : null,
    sleepLightSecs: withStages ? 11630 : null,
  };
}

const href = (d: string) => `/body?tab=sleep&night=${d}`;

describe("SleepHistoryStrip", () => {
  it("renders nothing when there is no history", () => {
    expect(
      renderToString(
        <SleepHistoryStrip nights={[]} selectedDate={null} href={href} />
      )
    ).toBe("");
  });

  // Caught in a real browser, not by any unit test: 14 cells are wider than a
  // phone viewport, so rendering oldest-first put the newest night (the
  // selected one) off-screen at x=528 on a 420px viewport, unclickable and
  // invisible until the user scrolled right.
  it("puts the newest night first so it is visible without scrolling", () => {
    const html = renderToString(
      <SleepHistoryStrip
        nights={[night("2026-07-30"), night("2026-07-31"), night("2026-08-01")]}
        selectedDate="2026-08-01"
        href={href}
      />
    );
    const order = ["2026-08-01", "2026-07-31", "2026-07-30"].map((d) =>
      html.indexOf(d)
    );
    expect(order[0]).toBeGreaterThanOrEqual(0);
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("marks the selected night for assistive tech, not just visually", () => {
    const html = renderToString(
      <SleepHistoryStrip
        nights={[night("2026-07-31"), night("2026-08-01")]}
        selectedDate="2026-07-31"
        href={href}
      />
    );
    expect(html).toContain('aria-current="date"');
    // Exactly one selected cell.
    expect(html.match(/aria-current="date"/g)).toHaveLength(1);
  });

  it("announces a stage-less night rather than hiding it", () => {
    const html = renderToString(
      <SleepHistoryStrip
        nights={[night("2026-07-31"), night("2026-08-01", false)]}
        selectedDate="2026-08-01"
        href={href}
      />
    );
    expect(html).toContain("2026-08-01, no stage data");
    expect(html).toContain("2026-07-31");
  });

  // WCAG 2.5.3, Label in Name: each night shows a weekday initial over a day
  // number, and its accessible name has to contain that, in that order.
  it("puts each night's visible label inside its accessible name", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <SleepHistoryStrip
        nights={[night("2026-07-31"), night("2026-08-01", false)]}
        selectedDate="2026-08-01"
        href={href}
      />
    );
    const links = Array.from(host.querySelectorAll("a"));
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(labelInName(a)).toMatchObject({ ok: true });
    }
    expect(labelInName(links[0]).name).toBe("S 01, 2026-08-01, no stage data");
  });

  it("links every night through the supplied href builder", () => {
    const html = renderToString(
      <SleepHistoryStrip
        nights={[night("2026-07-31"), night("2026-08-01")]}
        selectedDate="2026-08-01"
        href={href}
      />
    );
    expect(html).toContain("/body?tab=sleep&amp;night=2026-07-31");
    expect(html).toContain("/body?tab=sleep&amp;night=2026-08-01");
  });

  it("holds the floor — the weekday initial was 8px, the app's smallest text", () => {
    const html = renderToString(
      <SleepHistoryStrip
        nights={[
          {
            date: "2026-08-11",
            sleepSecs: 27000,
            sleepDeepSecs: 5400,
            sleepRemSecs: 5400,
            sleepLightSecs: 16200,
          },
        ]}
        selectedDate="2026-08-11"
        href={(d) => `/body?night=${d}`}
      />
    );
    expect(html).not.toMatch(/text-\[\d/);
    expect(html).not.toContain("text-white/");
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BodyTabs } from "./body-tabs";

const href = (over: { tab?: string }) => `/body?tab=${over.tab}`;

describe("BodyTabs", () => {
  it("marks the active segment for assistive tech, not just visually", () => {
    const html = renderToString(<BodyTabs active="sleep" href={href} />);
    expect(html).toContain('aria-current="page"');
    // The active pill is the only one carrying it.
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("renders every tab at the 12px floor, never below it", () => {
    const html = renderToString(<BodyTabs active="trends" href={href} />);
    expect(html).toContain("text-label");
    expect(html).not.toMatch(/text-\[\d/);
    for (const label of ["Trends", "Sleep", "Journal", "Labs"])
      expect(html).toContain(label);
  });

  it("gives the inactive segments a surface, so they read as controls", () => {
    const html = renderToString(<BodyTabs active="trends" href={href} />);
    expect(html).toContain("bg-surface-raised");
    expect(html).toContain("bg-surface-overlay");
    expect(html).not.toContain("bg-white/");
  });
});

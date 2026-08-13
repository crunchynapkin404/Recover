import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { TrainTabs } from "./train-tabs";
import type { TrainHref } from "@/lib/log-href";

const href: TrainHref = (over) => `/train?tab=${over.tab ?? "week"}`;

describe("TrainTabs", () => {
  it("renders all four segments and marks the active one for assistive tech", () => {
    const html = renderToString(<TrainTabs active="season" href={href} />);
    expect(html).toContain("Week");
    expect(html).toContain("History");
    expect(html).toContain("Season");
    expect(html).toContain("Fitness");
    expect(html).toContain('aria-current="page"');
    // Exactly one segment is current.
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("uses the token type and ink scale, not ad-hoc white alphas", () => {
    const html = renderToString(<TrainTabs active="week" href={href} />);
    expect(html).toMatch(/text-label/);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
  });
});

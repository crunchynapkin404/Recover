import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { TrainTabs } from "./train-tabs";
import type { TrainHref } from "@/lib/log-href";

const href: TrainHref = (over) => `/train?tab=${over.tab ?? "week"}`;

describe("TrainTabs", () => {
  it("renders all three segments and marks the active one for assistive tech", () => {
    const html = renderToString(<TrainTabs active="fitness" href={href} />);
    expect(html).toContain("Week");
    expect(html).toContain("History");
    expect(html).toContain("Fitness");
    // Season is retired from the offered set (its telemetry key stays
    // readable — see RETIRED_SURFACE_KEYS in lib/telemetry.ts — but it is no
    // longer a segment the nav renders).
    expect(html).not.toContain("Season");
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

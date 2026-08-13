import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { IntakeForm } from "./intake-form";

const resolved = Array.from({ length: 7 }, (_, i) =>
  i === 2
    ? [
        {
          start: "18:00",
          end: "19:30",
          mins: 90,
          energy: "normal" as const,
          sports: null,
        },
      ]
    : []
);
const noop = vi.fn();

describe("IntakeForm", () => {
  it("carries each day's blocks into the form as JSON", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={[]}
        verdict={{ kind: "ok" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).toContain('name="blocks-2"');
  });

  it("badges a day that is pinned by an override", () => {
    const dates = [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ];
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={["2026-08-05"]}
        dates={dates}
        verdict={{ kind: "ok" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).toContain("Pinned");
  });

  it("shows the weekly total", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={[]}
        verdict={{ kind: "ok" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).toContain("1h 30m this week");
  });

  it("warns when the time given cannot hold fitness", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={[]}
        verdict={{ kind: "losing", maintenanceHrs: 6, projectedCtl: 57 }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).toContain("6h");
    expect(html).toContain("57");
  });

  it("says nothing at all when the verdict is silent", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={[]}
        verdict={{ kind: "silent" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).not.toContain("hold your fitness");
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={["2026-08-05"]}
        dates={[
          "2026-08-03",
          "2026-08-04",
          "2026-08-05",
          "2026-08-06",
          "2026-08-07",
          "2026-08-08",
          "2026-08-09",
        ]}
        verdict={{ kind: "losing", maintenanceHrs: 6, projectedCtl: 57 }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });
});

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SleepNightCard } from "./sleep-night-card";

const stages = {
  deepSecs: 5460, // 1:31
  remSecs: 6240, // 1:44
  lightSecs: 12720, // 3:32
  awakeSecs: 1500, // 0:25
};

const base = {
  totalSecs: 25920, // 7:12
  bedWindow: null,
  consistency: null,
  chronotype: null,
  bedtimeTonight: null,
};

describe("SleepNightCard", () => {
  it("labels every stage with its real duration", () => {
    const html = renderToString(<SleepNightCard {...base} stages={stages} />);
    expect(html).toContain("Deep");
    expect(html).toContain("1:31");
    expect(html).toContain("REM");
    expect(html).toContain("1:44");
    expect(html).toContain("Light");
    expect(html).toContain("3:32");
    expect(html).toContain("Awake");
    expect(html).toContain("0:25");
  });

  it("shows total sleep in the header", () => {
    const html = renderToString(<SleepNightCard {...base} stages={stages} />);
    expect(html).toContain("7:12");
  });

  it("says the provider sends no stages rather than estimating a split", () => {
    const html = renderToString(<SleepNightCard {...base} stages={null} />);
    // React splices "<!-- -->" between JSX text nodes; match the escaped
    // apostrophe form the renderer actually emits.
    expect(html).toContain("send sleep stages");
    expect(html).not.toContain("Deep");
  });

  it("distinguishes an unrecorded night from a stage-less one", () => {
    const html = renderToString(
      <SleepNightCard {...base} totalSecs={null} stages={null} />
    );
    expect(html).toContain("No sleep recorded last night");
  });

  it("renders the footer only for the facts it actually has", () => {
    const html = renderToString(
      <SleepNightCard
        {...base}
        stages={stages}
        consistency={78}
        chronotype="midpoint 03:41"
        bedtimeTonight="23:10"
      />
    );
    expect(html).toContain("Consistency");
    expect(html).toContain("78");
    expect(html).toContain("midpoint 03:41");
    expect(html).toContain("bed by ");
    expect(html).toContain("23:10");
  });

  it("drops the footer entirely when nothing is known", () => {
    const html = renderToString(<SleepNightCard {...base} stages={stages} />);
    expect(html).not.toContain("Consistency");
    expect(html).not.toContain("Chronotype");
    expect(html).not.toContain("bed by ");
  });
});

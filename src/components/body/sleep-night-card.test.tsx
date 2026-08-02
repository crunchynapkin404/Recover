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
  heading: "Last night",
  stagesUnsupported: false,
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

  // Caught in a real browser: a real 3597s deep-sleep value rendered "0:60"
  // because hours and minutes were computed independently, so the minute
  // part rounded to 60 without carrying.
  it("carries rounded minutes into the hour instead of printing :60", () => {
    const html = renderToString(
      <SleepNightCard
        {...base}
        totalSecs={3597}
        stages={{ ...stages, deepSecs: 3597 }}
      />
    );
    expect(html).toContain("1:00");
    expect(html).not.toContain("0:60");
  });

  it("drops a zero-duration stage instead of drawing an empty slice", () => {
    // Awake is always 0 on the intervals.icu route: that feed's total is
    // asleep time, so deep+REM+light sums to it exactly. Never derive it.
    const html = renderToString(
      <SleepNightCard {...base} stages={{ ...stages, awakeSecs: 0 }} />
    );
    expect(html).not.toContain("Awake");
    expect(html).toContain("Deep");
  });

  // The distinction that made history navigation necessary: the Companion
  // writes a night's duration before its stages, so the newest night is
  // routinely stage-less while complete nights sit right behind it.
  it("says stages are missing for THIS night when others have them", () => {
    const html = renderToString(<SleepNightCard {...base} stages={null} />);
    expect(html).toContain("No stages recorded for this night yet");
    expect(html).not.toContain("send sleep stages");
    expect(html).not.toContain("Deep");
  });

  it("blames the provider only when no night has stages", () => {
    const html = renderToString(
      <SleepNightCard {...base} stages={null} stagesUnsupported />
    );
    expect(html).toContain("send sleep stages");
    expect(html).not.toContain("No stages recorded for this night yet");
  });

  it("distinguishes an unrecorded night from a stage-less one", () => {
    const html = renderToString(
      <SleepNightCard {...base} totalSecs={null} stages={null} />
    );
    expect(html).toContain("No sleep recorded for this night");
  });

  it("uses the supplied heading so a past night isn't labelled last night", () => {
    const html = renderToString(
      <SleepNightCard {...base} stages={stages} heading="2026-07-31" />
    );
    expect(html).toContain("2026-07-31");
    expect(html).not.toContain("Last night");
  });

  it("renders navigation links only where there is somewhere to go", () => {
    const both = renderToString(
      <SleepNightCard
        {...base}
        stages={stages}
        prevHref="/body?tab=sleep&night=2026-07-30"
        nextHref="/body?tab=sleep"
      />
    );
    expect(both).toContain("night=2026-07-30");
    expect(both).toContain("Previous night");
    expect(both).toContain("Next night");

    const neither = renderToString(
      <SleepNightCard {...base} stages={stages} />
    );
    expect(neither).not.toContain("Previous night");
    expect(neither).not.toContain("Next night");
  });

  // Tonight's bedtime describes tonight, not the night on screen — the tab
  // passes it only for the latest night.
  it("shows tonight's bedtime only when given one", () => {
    const withIt = renderToString(
      <SleepNightCard {...base} stages={stages} bedtimeTonight="23:10" />
    );
    expect(withIt).toContain("bed by ");
    expect(withIt).toContain("23:10");

    const without = renderToString(
      <SleepNightCard {...base} stages={stages} />
    );
    expect(without).not.toContain("bed by ");
  });

  // 30-day aggregates moved out of this card in v0.35: they describe the
  // athlete's rhythm, not the selected night.
  it("no longer claims consistency or chronotype as properties of the night", () => {
    const html = renderToString(<SleepNightCard {...base} stages={stages} />);
    expect(html).not.toContain("Consistency");
    expect(html).not.toContain("Chronotype");
  });
});

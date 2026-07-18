import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SleepStagesCard } from "./sleep-stages-card";
import { SleepQualityCard } from "./sleep-quality-card";

describe("SleepStagesCard", () => {
  const base = {
    deepSecs: 5400,
    remSecs: 5400,
    lightSecs: 14400,
    awakeSecs: 1800,
    fractions: { deep: 0.2, rem: 0.2, light: 0.53, awake: 0.07 },
  };

  it("renders stage durations and the bed window", () => {
    const html = renderToString(
      <SleepStagesCard {...base} bedWindow={{ start: "23:30", end: "07:30" }} />
    );
    expect(html).toContain("Sleep Stages");
    expect(html).toContain("1h 30m"); // deep 5400s
    expect(html).toContain("4h 0m"); // light 14400s
    // server HTML puts comment nodes between JSX expressions, so match parts
    expect(html).toContain("23:30");
    expect(html).toContain("07:30");
  });

  it("omits the bed window when absent", () => {
    const html = renderToString(<SleepStagesCard {...base} bedWindow={null} />);
    expect(html).not.toContain("07:30");
  });
});

describe("SleepQualityCard", () => {
  it("renders the consistency score and reading", () => {
    const html = renderToString(
      <SleepQualityCard
        consistency={{ score: 88, sampleNights: 12 }}
        chronotype={null}
      />
    );
    expect(html).toContain("Consistency");
    expect(html).toContain("88");
    expect(html).toContain("Very regular");
    expect(html).toContain("12"); // sample nights
  });

  it("renders chronotype midpoint and social jetlag reading", () => {
    const html = renderToString(
      <SleepQualityCard
        consistency={null}
        chronotype={{ midpointHhMm: "03:15", socialJetlagMins: 75 }}
      />
    );
    expect(html).toContain("03:15");
    expect(html).toContain("Notable social jetlag");
    expect(html).not.toContain("Consistency");
  });
});

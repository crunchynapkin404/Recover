import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DayLogCard } from "./day-log-card";

const full = {
  scores: [
    { label: "Energy", value: 7 },
    { label: "Soreness", value: 3 },
    { label: "Stress", value: 4 },
  ],
  tags: ["☕ Caffeine", "💧 Hydration"],
  notes: "Legs felt heavy on the climb but recovered fast.",
  debriefLine: "Endurance Spin — RPE 6 · felt normal",
};

describe("DayLogCard", () => {
  it("renders every logged score with its label", () => {
    const html = renderToString(<DayLogCard {...full} />);
    expect(html).toContain("Energy");
    expect(html).toContain("7");
    expect(html).toContain("Soreness");
    expect(html).toContain("Stress");
  });

  it("renders the tags and the note", () => {
    const html = renderToString(<DayLogCard {...full} />);
    expect(html).toContain("☕ Caffeine");
    expect(html).toContain("💧 Hydration");
    expect(html).toContain("Legs felt heavy on the climb");
  });

  it("folds in the debrief answer", () => {
    const html = renderToString(<DayLogCard {...full} />);
    expect(html).toContain("Endurance Spin — RPE 6 · felt normal");
  });

  it("shows a logged zero rather than dropping it", () => {
    const html = renderToString(
      <DayLogCard {...full} scores={[{ label: "Stress", value: 0 }]} />
    );
    expect(html).toContain("Stress");
    expect(html).toContain(">0<");
  });

  it("renders nothing when the day holds no log at all", () => {
    expect(
      renderToString(
        <DayLogCard scores={[]} tags={[]} notes={null} debriefLine={null} />
      )
    ).toBe("");
  });

  it("renders nothing when the only content is a whitespace-only debrief line", () => {
    expect(
      renderToString(
        <DayLogCard scores={[]} tags={[]} notes={null} debriefLine="   " />
      )
    ).toBe("");
  });

  it("renders nothing when the only content is whitespace-only notes", () => {
    expect(
      renderToString(
        <DayLogCard scores={[]} tags={[]} notes="   " debriefLine={null} />
      )
    ).toBe("");
  });

  it("renders on a debrief alone, with no self-report", () => {
    const html = renderToString(
      <DayLogCard
        scores={[]}
        tags={[]}
        notes={null}
        debriefLine="Endurance Spin — RPE 6"
      />
    );
    expect(html).toContain("Endurance Spin — RPE 6");
  });

  it("omits the empty parts rather than showing empty slots", () => {
    const html = renderToString(
      <DayLogCard
        scores={full.scores}
        tags={[]}
        notes={null}
        debriefLine={null}
      />
    );
    expect(html).toContain("Energy");
    expect(html).not.toContain("☕");
    expect(html).not.toContain("&ldquo;");
  });

  it("uses the token type and ink scales", () => {
    const html = renderToString(<DayLogCard {...full} />);
    expect(html).toContain("text-label");
    expect(html).toMatch(/text-ink-(primary|secondary|muted)/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
  });
});

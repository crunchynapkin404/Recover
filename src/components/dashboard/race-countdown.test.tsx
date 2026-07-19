import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { RaceCountdownCard } from "./race-countdown";

const race = {
  name: "City Marathon",
  date: "2026-08-30",
  priority: "A",
  goalNote: "sub 3:30",
};

describe("RaceCountdownCard", () => {
  it("renders nothing without a race", () => {
    expect(
      renderToString(
        <RaceCountdownCard race={null} daysOut={null} outlook={null} />
      )
    ).toBe("");
  });

  it("shows countdown and a labelled projection range", () => {
    const html = renderToString(
      <RaceCountdownCard
        race={race}
        daysOut={42}
        outlook={{
          kind: "projection",
          full: { tsb: 8.2, band: "green" },
          adherence: { tsb: 4.1, band: "amber" },
          capped: false,
        }}
      />
    );
    expect(html).toContain("City Marathon");
    expect(html).toContain("42");
    expect(html.toLowerCase()).toContain("projection");
    expect(html).toContain("amber–green"); // straddling band range
    expect(html.toLowerCase()).toContain("form outlook");
    expect(html.toLowerCase()).not.toContain("readiness");
  });

  it("agreeing scenarios show a single band", () => {
    const html = renderToString(
      <RaceCountdownCard
        race={race}
        daysOut={10}
        outlook={{
          kind: "projection",
          full: { tsb: 9, band: "green" },
          adherence: { tsb: 7.5, band: "green" },
          capped: false,
        }}
      />
    );
    expect(html).not.toContain("–green"); // no range separator
    expect(html).toContain("green");
  });

  it("insufficient shows the calibrating state, never a number", () => {
    const html = renderToString(
      <RaceCountdownCard
        race={race}
        daysOut={42}
        outlook={{ kind: "insufficient" }}
      />
    );
    expect(html.toLowerCase()).toContain("calibrat");
    expect(html).not.toContain("TSB");
  });

  it("no plan shows the CTA", () => {
    const html = renderToString(
      <RaceCountdownCard
        race={race}
        daysOut={42}
        outlook={{ kind: "no_plan" }}
      />
    );
    expect(html).toContain("No plan targets this race");
  });
});

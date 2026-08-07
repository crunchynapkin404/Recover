import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { EventReadiness } from "./event-readiness";

const demand = {
  available: true as const,
  totalHours: 50,
  dailyRateHours: 6.3,
  queenStageHours: 7,
  queenStageKnown: true,
  weeklyHours: 11,
  source: "computed" as const,
  confidence: "medium" as const,
  confidenceReason: "Modelled from your FTP and the course profile.",
};

const feasibility = {
  verdict: "on_track" as const,
  volumeWeeksNeeded: 2,
  longestSessionWeeksNeeded: 3,
  weeksUntilEvent: 8,
  requiredLongestSessionHours: 5.6,
  fromAverageDay: false,
};

describe("EventReadiness", () => {
  it("names the event and what it asks per week", () => {
    const html = renderToString(
      <EventReadiness
        raceName="Dolomites"
        sport="Bike"
        feasibility={feasibility}
        demand={demand}
      />
    );
    expect(html).toContain("Dolomites");
    expect(html).toContain("11h");
  });

  it("states the longest-ride requirement, not just volume", () => {
    const html = renderToString(
      <EventReadiness
        raceName="Dolomites"
        sport="Bike"
        feasibility={feasibility}
        demand={demand}
      />
    );
    expect(html.toLowerCase()).toContain("longest ride");
  });

  it("is explicit and unhedged when the event is not realistic", () => {
    const html = renderToString(
      <EventReadiness
        raceName="Dolomites"
        sport="Bike"
        feasibility={{
          ...feasibility,
          verdict: "not_realistic",
          weeksUntilEvent: 3,
        }}
        demand={demand}
      />
    );
    expect(html.toLowerCase()).toContain("not realistic");
  });

  it("says when it is reasoning from an average day", () => {
    const html = renderToString(
      <EventReadiness
        raceName="Dolomites"
        sport="Bike"
        feasibility={{ ...feasibility, fromAverageDay: true }}
        demand={{ ...demand, queenStageKnown: false }}
      />
    );
    expect(html.toLowerCase()).toContain("average day");
  });

  it("never prints Infinity weeks", () => {
    // `weeksToGrow` returns Infinity when current hours are zero, and
    // `assessFeasibility` only returns null when they are NULL — so an
    // athlete with a race and no measured training reaches this component
    // with a non-finite figure. "Closing the gap needs Infinity weeks" is
    // the single worst sentence this feature could show someone.
    const html = renderToString(
      <EventReadiness
        raceName="Dolomites"
        sport="Bike"
        feasibility={{
          ...feasibility,
          verdict: "not_realistic",
          volumeWeeksNeeded: Infinity,
          longestSessionWeeksNeeded: Infinity,
        }}
        demand={demand}
      />
    );
    expect(html).not.toContain("Infinity");
    expect(html).toContain("no recent training");
  });

  it("counts a single week in the singular", () => {
    const html = renderToString(
      <EventReadiness
        raceName="Dolomites"
        sport="Bike"
        feasibility={{ ...feasibility, weeksUntilEvent: 1 }}
        demand={demand}
      />
    );
    expect(html).toContain("1 week to go");
    expect(html).not.toContain("1 weeks");
  });

  it("says 'longest run' to a runner", () => {
    const html = renderToString(
      <EventReadiness
        raceName="Rotterdam Marathon"
        sport="Run"
        feasibility={feasibility}
        demand={demand}
      />
    );
    expect(html.toLowerCase()).toContain("longest run");
    expect(html.toLowerCase()).not.toContain("longest ride");
  });

  it("says 'longest bike leg' to a triathlete", () => {
    const html = renderToString(
      <EventReadiness
        raceName="Ironman Hamburg"
        sport="Triathlon"
        feasibility={feasibility}
        demand={demand}
      />
    );
    expect(html.toLowerCase()).toContain("longest bike leg");
  });

  it("shows the confidence reason for every available figure", () => {
    const html = renderToString(
      <EventReadiness
        raceName="Rotterdam Marathon"
        sport="Run"
        feasibility={feasibility}
        demand={{
          ...demand,
          confidence: "low",
          confidenceReason: "Estimated from your recent runs.",
        }}
      />
    );
    expect(html).toContain("Estimated from your recent runs");
  });

  it("says WHY there is no figure instead of rendering nothing", () => {
    // The whole point of v0.46: before this, an unpriceable race produced a
    // silent fallback and an empty screen.
    const html = renderToString(
      <EventReadiness
        raceName="Ironman Hamburg"
        sport="Triathlon"
        feasibility={null}
        demand={{ available: false, reason: "no_swim_anchor" }}
      />
    );
    expect(html.toLowerCase()).toContain("no recent swims");
  });
});

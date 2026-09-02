// @vitest-environment jsdom
/**
 * The race-result line on a Races-sheet row.
 *
 * This is the ONLY durable place a finished race appears. Before v0.130.0 a
 * race vanished from every screen the moment the debrief set `completed`:
 * `RaceChip` is built from `nextUpcomingRace`, which filters `upcoming`. So a
 * row that renders nothing here is not a cosmetic gap — it is the whole
 * surface for the comparison.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Figure } from "@/lib/uncertainty";
import type { PacingComparison } from "@/lib/race/pacing-result";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/plan/actions", () => ({
  addRace: vi.fn(async () => ({ ok: true })),
  removeRace: vi.fn(async () => {}),
  setRaceStatus: vi.fn(async () => ({ ok: true })),
}));

import { RacesSection, type RaceListItem } from "./races-section";

let root: Root | null = null;
let container: HTMLDivElement;

const bike: PacingComparison = {
  sport: "Bike",
  targetWatts: 208,
  lowWatts: 198,
  highWatts: 218,
  actualWatts: 214,
  deltaWatts: 6,
  deltaPct: 2.9,
  verdict: "harder",
  raceDistanceKm: 90,
  actualDistanceKm: 90.4,
};

const race = (over: Partial<RaceListItem> = {}): RaceListItem => ({
  id: "r1",
  name: "Alpine Tour",
  raceType: "gran fondo",
  date: "2026-08-12",
  priority: "A",
  status: "completed",
  goalNote: null,
  sport: "Bike",
  expectedFinishHours: null,
  eventDays: 1,
  distanceKm: 90,
  elevationM: 900,
  stages: [],
  ...over,
});

async function render(item: RaceListItem) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RacesSection races={[item]} />);
  });
  return container.textContent ?? "";
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
});

describe("the race-result line", () => {
  it("renders the comparison, its assumption and its confidence", async () => {
    const text = await render(
      race({
        pacingResult: Figure.available(
          bike,
          "medium",
          "Assumed a steady effort. The target was not recorded before the start."
        ),
      })
    );
    expect(text).toContain("you held 214 W");
    expect(text).toContain("Predicted 208 W");
    // The verdict in words — the delta's sign is not the athlete's job to read.
    expect(text).toContain("harder than the band");
    // THE ASSUMPTION MUST RENDER. It is the half a tooltip would drop, and
    // this figure has a harder thing to admit than most: the target was
    // recomputed, not recorded.
    expect(text).toContain("not recorded before the start");
    expect(text).toContain("medium confidence");
  });

  it("renders a refusal as its stated reason, not as a blank row", async () => {
    const text = await render(
      race({
        pacingResult: Figure.notApplicable(
          "The result for this race is a Strava activity, and its numbers are excluded from AI analysis under Strava's API agreement."
        ),
      })
    );
    expect(text).toContain("Race pacing:");
    expect(text).toMatch(/Strava/);
  });

  it("renders a missing input as what is missing", async () => {
    const text = await render(
      race({ pacingResult: Figure.missingInput("this race's result activity") })
    );
    expect(text).toContain("result activity");
  });

  /**
   * An UPCOMING race must look exactly as it always has. The comparison is
   * null there — distinct from an unavailable Figure, which means the race
   * has (or should have) a result and something specific is in the way.
   */
  it("adds nothing at all to a race that was never raced", async () => {
    const text = await render(race({ status: "upcoming", pacingResult: null }));
    expect(text).not.toContain("Race pacing");
    expect(text).not.toContain("you held");
    expect(container.querySelector("[data-race-pacing-result]")).toBeNull();
  });

  it("adds nothing when the prop is absent entirely", async () => {
    // Every existing caller predates this field; an omitted prop must not
    // render an empty line or throw.
    const text = await render(race());
    expect(text).toContain("Alpine Tour");
    expect(container.querySelector("[data-race-pacing-result]")).toBeNull();
  });
});

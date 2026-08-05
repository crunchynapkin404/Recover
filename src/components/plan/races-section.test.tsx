import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { RacesSection, type RaceListItem } from "./races-section";

const races: RaceListItem[] = [
  {
    id: "1",
    name: "City Marathon",
    raceType: "marathon",
    date: "2026-08-30",
    priority: "A" as const,
    status: "upcoming" as const,
    goalNote: "sub 3:30",
    sport: "Bike" as const,
    eventDays: 1,
    distanceKm: 42.2,
    elevationM: 250,
    stages: [],
  },
];

describe("RacesSection", () => {
  it("lists races with priority chips", () => {
    const html = renderToString(<RacesSection races={races} />);
    expect(html).toContain("City Marathon");
    expect(html).toContain("A");
    expect(html).toContain("sub 3:30");
  });

  it("empty state invites adding a race", () => {
    const html = renderToString(<RacesSection races={[]} />);
    expect(html.toLowerCase()).toContain("no races");
  });

  it("add form has native required fields", () => {
    const html = renderToString(<RacesSection races={[]} />);
    expect(html).toContain('name="name"');
    expect(html).toContain('name="raceType"');
    expect(html).toContain('name="date"');
  });

  // Final-review Finding I6: the add form captured days/distance/elevation/
  // stages but the list never showed them back — a mistyped 20,000m instead
  // of 2,000m silently moved prescribed training volume with no way to see
  // what was stored. These pin that the list is no longer write-only.
  it("shows the stored distance and elevation for a race", () => {
    const html = renderToString(<RacesSection races={races} />);
    expect(html).toContain("42.2km");
    expect(html).toContain("250m");
  });

  it("shows the day count for a multi-day event", () => {
    const html = renderToString(
      <RacesSection
        races={[
          {
            ...races[0],
            id: "2",
            name: "Alpine Tour",
            eventDays: 8,
            distanceKm: 900,
            elevationM: 20000,
          },
        ]}
      />
    );
    expect(html).toContain("8 days");
    expect(html).toContain("900km");
    expect(html).toContain("20000m");
  });

  it("flags when per-day stage detail is on file", () => {
    const html = renderToString(
      <RacesSection
        races={[
          {
            ...races[0],
            id: "3",
            eventDays: 3,
            stages: [
              { dayNumber: 1, distanceKm: 100, elevationM: 1000 },
              { dayNumber: 2, distanceKm: 120, elevationM: 1200 },
            ],
          },
        ]}
      />
    );
    expect(html).toContain("per-day detail");
  });

  it("says plainly when no demand data is stored, rather than staying silent", () => {
    const html = renderToString(
      <RacesSection
        races={[{ ...races[0], id: "4", distanceKm: null, elevationM: null }]}
      />
    );
    expect(html).toContain("No distance/elevation set");
  });
});

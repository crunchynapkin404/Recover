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
    expectedFinishHours: null,
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

  it("paints A-priority races in the race ink token, not a fuchsia literal", () => {
    const html = renderToString(<RacesSection races={races} />);
    expect(html).toMatch(/text-ink-race/);
    expect(html).not.toMatch(/fuchsia/);
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const html = renderToString(<RacesSection races={races} />);
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });

  // This section only ever renders inside the "races" sheet (train/page.tsx
  // slice 2 task 3), whose own panel is bg-surface-overlay — `.glass`
  // resolves to the SAME #ffffff as that overlay in light mode, painting an
  // invisible fill behind a bare hairline on all three of this section's
  // panels (the empty state, the races list, and the add-race disclosure).
  // Pinned as its own assertion, not folded into the token-scale test
  // above, because `.glass` is a real, valid class elsewhere in this app —
  // this is a "wrong token for this container" bug, not a raw-value one.
  it("fills its panels with surface-selected, not glass (invisible on the sheet's own white overlay)", () => {
    const empty = renderToString(<RacesSection races={[]} />);
    expect(empty).toContain("bg-surface-selected");
    expect(empty).not.toMatch(/\bglass\b/);

    const withRaces = renderToString(<RacesSection races={races} />);
    expect(withRaces).toContain("bg-surface-selected");
    expect(withRaces).not.toMatch(/\bglass\b/);
  });

  it("hides its own micro-label when the caller already names the panel", () => {
    const shown = renderToString(<RacesSection races={races} />);
    expect(shown).toContain("Races");

    const hidden = renderToString(<RacesSection races={races} hideHeading />);
    // The section's own heading is the sole "Races" text it ever renders —
    // hiding it must leave nothing behind for that exact string, while the
    // rest of the panel (the race itself) is unaffected by the flag.
    expect(hidden).not.toContain("Races");
    expect(hidden).toContain("City Marathon");
  });
});

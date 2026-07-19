import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { RacesSection } from "./races-section";

const races = [
  {
    id: "1",
    name: "City Marathon",
    raceType: "marathon",
    date: "2026-08-30",
    priority: "A" as const,
    status: "upcoming" as const,
    goalNote: "sub 3:30",
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
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "use server" is a genuine module boundary, not the logic under test; the
// write path has its own DB coverage (tests/plan-actions-race.test.ts).
// Stubbed the same way races-section-demand.test.tsx does for addRace.
vi.mock("@/app/plan/actions", () => ({
  addRace: vi.fn(async () => ({ ok: true })),
  removeRace: vi.fn(async () => {}),
  setRaceStatus: vi.fn(async () => ({ ok: true })),
  updateRaceDemand: vi.fn(async () => ({ ok: true })),
}));

import { RacesSection, type RaceListItem } from "./races-section";
import { updateRaceDemand } from "@/app/plan/actions";

const updateRaceDemandMock = vi.mocked(updateRaceDemand);

let root: Root | null = null;
let container: HTMLDivElement;

const RACE: RaceListItem = {
  id: "r1",
  name: "Alpine Tour",
  raceType: "gran fondo",
  date: "2026-09-01",
  priority: "A",
  status: "upcoming",
  goalNote: null,
  sport: "Bike",
  eventDays: 2,
  distanceKm: 220,
  elevationM: 5000,
  expectedFinishHours: null,
  stages: [
    { dayNumber: 1, distanceKm: 100, elevationM: 2500 },
    { dayNumber: 2, distanceKm: 120, elevationM: 2500 },
  ],
};

async function render(races: RaceListItem[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RacesSection races={races} />);
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
  vi.clearAllMocks();
});

const byId = (id: string): HTMLInputElement => {
  const el = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`no field with id ${id}`);
  return el;
};

const byLabel = (label: string): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);

async function clickButtonByLabel(label: string) {
  const btn = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  );
  if (!btn) throw new Error(`no button with aria-label "${label}"`);
  await act(async () => {
    btn.click();
  });
}

async function set(el: HTMLInputElement, value: string) {
  await act(async () => {
    // React tracks the previous value on the DOM node; bypass its setter or
    // the synthetic change event is swallowed as a no-op.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Final-review Finding I6 part 2: correcting a race's stored demand used to
// mean deleting the race and re-adding it. These pin that a real edit path
// exists, is pre-filled from what's actually stored, and writes through
// updateRaceDemand rather than just holding local state.
describe("RacesSection demand edit", () => {
  it("is closed by default — no edit form rendered until Edit is clicked", async () => {
    await render([RACE]);
    expect(
      container.querySelector('[aria-label="Demand form for Alpine Tour"]')
    ).toBeNull();
  });

  it("opens pre-filled with the race's stored totals and per-day stages", async () => {
    await render([RACE]);
    await clickButtonByLabel("Edit demand for Alpine Tour");

    expect(byId("edit-r1-event-days").value).toBe("2");
    expect(byId("edit-r1-event-distance").value).toBe("220");
    expect(byId("edit-r1-event-elevation").value).toBe("5000");
    expect(byLabel("Edit Alpine Tour: Day 1 distance in km")?.value).toBe(
      "100"
    );
    expect(byLabel("Edit Alpine Tour: Day 1 elevation in m")?.value).toBe(
      "2500"
    );
    expect(byLabel("Edit Alpine Tour: Day 2 distance in km")?.value).toBe(
      "120"
    );
  });

  it("toggles closed when Edit is clicked again", async () => {
    await render([RACE]);
    await clickButtonByLabel("Edit demand for Alpine Tour");
    expect(
      container.querySelector('[aria-label="Demand form for Alpine Tour"]')
    ).not.toBeNull();

    await clickButtonByLabel("Edit demand for Alpine Tour");
    expect(
      container.querySelector('[aria-label="Demand form for Alpine Tour"]')
    ).toBeNull();
  });

  it("submits a correction through updateRaceDemand, scoped to that race's id", async () => {
    await render([RACE]);
    await clickButtonByLabel("Edit demand for Alpine Tour");

    // The whole point of Finding I6: 20,000m typed instead of 2,000m must be
    // correctable in place.
    await set(byId("edit-r1-event-elevation"), "2000");

    const form = container.querySelector<HTMLFormElement>(
      '[aria-label="Demand form for Alpine Tour"]'
    )!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });

    expect(updateRaceDemandMock).toHaveBeenCalledTimes(1);
    const [id, patch] = updateRaceDemandMock.mock.calls[0];
    expect(id).toBe("r1");
    expect(patch.elevationM).toBe(2000);
    expect(patch.distanceKm).toBe(220);
    expect(patch.eventDays).toBe(2);
    expect(patch.stages).toEqual([
      { dayNumber: 1, distanceKm: 100, elevationM: 2500 },
      { dayNumber: 2, distanceKm: 120, elevationM: 2500 },
    ]);
  });

  it("closes the form on a successful save", async () => {
    await render([RACE]);
    await clickButtonByLabel("Edit demand for Alpine Tour");
    const form = container.querySelector<HTMLFormElement>(
      '[aria-label="Demand form for Alpine Tour"]'
    )!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(
      container.querySelector('[aria-label="Demand form for Alpine Tour"]')
    ).toBeNull();
  });

  it("Cancel closes the form without calling updateRaceDemand", async () => {
    await render([RACE]);
    await clickButtonByLabel("Edit demand for Alpine Tour");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent === "Cancel")!
        .click();
    });
    expect(
      container.querySelector('[aria-label="Demand form for Alpine Tour"]')
    ).toBeNull();
    expect(updateRaceDemandMock).not.toHaveBeenCalled();
  });

  it("shows the server's error and keeps the form open when the save fails", async () => {
    updateRaceDemandMock.mockResolvedValueOnce({
      ok: false,
      error: "Elevation must be a valid number.",
    });
    await render([RACE]);
    await clickButtonByLabel("Edit demand for Alpine Tour");
    const form = container.querySelector<HTMLFormElement>(
      '[aria-label="Demand form for Alpine Tour"]'
    )!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(container.textContent).toContain(
      "Elevation must be a valid number."
    );
    expect(
      container.querySelector('[aria-label="Demand form for Alpine Tour"]')
    ).not.toBeNull();
  });

  it("editing one race's demand does not collide with the add form's own fields", async () => {
    // Both the add form and an open edit row can have multi-day detail open
    // at once — the id/aria-label prefixing must keep their fields distinct.
    await render([RACE]);
    await clickButtonByLabel("Edit demand for Alpine Tour");
    // Add form's own (unprefixed) fields must still resolve uniquely.
    expect(byId("event-days")).toBeTruthy();
    expect(byId("edit-r1-event-days")).toBeTruthy();
    expect(byId("event-days")).not.toBe(byId("edit-r1-event-days"));
  });

  it("saves a goal for a race that already exists", async () => {
    await render([{ ...RACE, goalNote: null }]);
    await clickButtonByLabel("Edit demand for Alpine Tour");

    const goal = byLabel("Goal for Alpine Tour");
    expect(goal).not.toBeNull();

    await set(goal!, "podium in my age group");

    const form = container.querySelector<HTMLFormElement>(
      '[aria-label="Demand form for Alpine Tour"]'
    )!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });

    expect(updateRaceDemandMock).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ goalNote: "podium in my age group" })
    );
  });

  it("prefills the goal a race already has", async () => {
    await render([{ ...RACE, goalNote: "finish upright" }]);
    await clickButtonByLabel("Edit demand for Alpine Tour");
    const goal = byLabel("Goal for Alpine Tour");
    expect(goal?.value).toBe("finish upright");
  });
});

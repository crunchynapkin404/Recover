// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/plan/actions", () => ({
  addRace: vi.fn(async () => ({ ok: true })),
  removeRace: vi.fn(async () => {}),
  setRaceStatus: vi.fn(async () => ({ ok: true })),
  updateRaceDemand: vi.fn(async () => ({ ok: true })),
}));

import { RacesSection, type RaceListItem } from "./races-section";
import { addRace, updateRaceDemand } from "@/app/plan/actions";

const addRaceMock = vi.mocked(addRace);
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
  stages: [],
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

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("race sport", () => {
  it("offers exactly the three sports the generator can build", async () => {
    await render([]);
    const select = container.querySelector(
      '[aria-label="Sport"]'
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect([...select.options].map((o) => o.value)).toEqual([
      "Bike",
      "Run",
      "Triathlon",
    ]);
  });

  it("pre-selects from the typed race type", async () => {
    await render([]);
    const raceType = container.querySelector(
      '[name="raceType"]'
    ) as HTMLInputElement;
    await act(async () => setValue(raceType, "gran fondo"));
    const select = container.querySelector(
      '[aria-label="Sport"]'
    ) as HTMLSelectElement;
    expect(select.value).toBe("Bike");

    await act(async () => setValue(raceType, "marathon"));
    expect(select.value).toBe("Run");
  });

  it("sends the chosen sport when adding", async () => {
    await render([]);
    const name = container.querySelector('[name="name"]') as HTMLInputElement;
    const raceType = container.querySelector(
      '[name="raceType"]'
    ) as HTMLInputElement;
    const date = container.querySelector('[name="date"]') as HTMLInputElement;
    await act(async () => {
      setValue(name, "Dolomites");
      setValue(raceType, "gran fondo");
      setValue(date, "2026-09-13");
    });
    const form = raceType.closest("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(addRaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ sport: "Bike" })
    );
  });

  it("lets an existing race's sport be corrected", async () => {
    await render([RACE]);
    const pencil = container.querySelector(
      `[aria-label="Edit demand for ${RACE.name}"]`
    ) as HTMLButtonElement;
    await act(async () => pencil.click());
    const select = container.querySelector(
      `[aria-label="Sport for ${RACE.name}"]`
    ) as HTMLSelectElement;
    expect(select.value).toBe("Bike");
    await act(async () => setValue(select, "Triathlon"));
    const form = container.querySelector(
      `[aria-label="Demand form for ${RACE.name}"]`
    ) as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(updateRaceDemandMock).toHaveBeenCalledWith(
      RACE.id,
      expect.objectContaining({ sport: "Triathlon" })
    );
  });
});

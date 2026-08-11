// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "use server" is a genuine module boundary, not the logic under test; the
// write path has its own DB coverage. Stubbed the same way journal-form does.
vi.mock("@/app/plan/actions", () => ({
  addRace: vi.fn(async () => ({ ok: true })),
  removeRace: vi.fn(async () => {}),
  setRaceStatus: vi.fn(async () => ({ ok: true })),
}));

import { RacesSection } from "./races-section";
import { addRace } from "@/app/plan/actions";

const addRaceMock = vi.mocked(addRace);

let root: Root | null = null;
let container: HTMLDivElement;

async function open() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<RacesSection races={[]} />);
  });
  await click("Add race");
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

async function click(text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  );
  if (!btn) throw new Error(`no button containing "${text}"`);
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

describe("RacesSection event demand", () => {
  it("captures days, distance and elevation for an event", async () => {
    await open();
    expect(byId("event-days")).toBeTruthy();
    expect(byId("event-distance")).toBeTruthy();
    expect(byId("event-elevation")).toBeTruthy();
  });

  it("only offers per-day stages once the event runs over more than one day", async () => {
    await open();
    expect(container.textContent).not.toContain("Per-day detail");
    await set(byId("event-days"), "8");
    expect(container.textContent).toContain("Per-day detail");
    expect(byLabel("Day 8 distance in km")).toBeTruthy();
  });

  it("sends the demand fields to addRace, not just to local state", async () => {
    // The defect this pins: fields that render, hold state, and are never
    // submitted. Rendering proves nothing about persistence.
    await open();
    await set(byId("race-name"), "Alpine Tour");
    await set(byId("race-date"), "2026-09-01");
    await set(byId("event-days"), "2");
    await set(byId("event-distance"), "220");
    await set(byId("event-elevation"), "5000");
    await set(byLabel("Day 1 distance in km")!, "100");
    await set(byLabel("Day 2 distance in km")!, "120");

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });

    expect(addRaceMock).toHaveBeenCalledTimes(1);
    const arg = addRaceMock.mock.calls[0][0];
    expect(arg.eventDays).toBe(2);
    expect(arg.distanceKm).toBe(220);
    expect(arg.elevationM).toBe(5000);
    expect(arg.stages).toEqual([
      { dayNumber: 1, distanceKm: 100, elevationM: null },
      { dayNumber: 2, distanceKm: 120, elevationM: null },
    ]);
  });

  it("sends no stages for a one-day event", async () => {
    await open();
    await set(byId("race-name"), "Gran Fondo");
    await set(byId("race-date"), "2026-09-01");
    await set(byId("event-distance"), "130");
    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
    });
    expect(addRaceMock.mock.calls[0][0].eventDays).toBe(1);
    expect(addRaceMock.mock.calls[0][0].stages).toEqual([]);
  });
});

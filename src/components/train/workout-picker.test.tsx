// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WorkoutPicker } from "./workout-picker";
import { pickerWorkouts } from "@/lib/interval/picker";
import { LIBRARY } from "@/lib/interval/library";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "use server" is a module boundary, not the logic under test.
vi.mock("@/app/train/pick-workout-actions", () => ({
  pickWorkoutAction: vi.fn(async () => ({ ok: true, message: "Added." })),
}));

const WORKOUTS = pickerWorkouts({
  band: "green",
  daysSinceQuality: 3,
  weekLoadFraction: 0.5,
  recentFamilies: [],
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(ui: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const base = {
  date: "2026-09-10",
  today: "2026-09-08",
  workouts: WORKOUTS,
  ftpWatts: 250 as number | null,
  warning: null as string | null,
};

describe("WorkoutPicker", () => {
  it("renders the whole library, not a shortlist", () => {
    const el = render(<WorkoutPicker {...base} />);
    expect(el.querySelectorAll("li").length).toBe(LIBRARY.length);
  });

  it("says how many of how many are shown", () => {
    const el = render(<WorkoutPicker {...base} />);
    expect(el.textContent).toContain(`${LIBRARY.length} of ${LIBRARY.length}`);
  });

  it("marks a recommended group inside the one list", () => {
    // A marker on the leading rows, never a separate screen with the rest
    // behind a second tap.
    const el = render(<WorkoutPicker {...base} />);
    const marks = [...el.querySelectorAll("span")].filter(
      (s) => s.textContent === "Recommended today"
    );
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.length).toBeLessThan(LIBRARY.length);
  });

  it("renders the warning where the athlete cannot miss it", () => {
    const el = render(
      <WorkoutPicker
        {...base}
        warning="This day was left clear for your race."
      />
    );
    const status = el.querySelector('[role="status"]');
    expect(status?.textContent).toContain("left clear for your race");
  });

  it("explains percentages when no FTP is set", () => {
    const el = render(<WorkoutPicker {...base} ftpWatts={null} />);
    expect(el.textContent).toContain("% of FTP");
  });

  it("says nothing about FTP when one is set", () => {
    const el = render(<WorkoutPicker {...base} />);
    expect(el.textContent).not.toContain("Set your FTP in Settings");
  });

  it("filters by purpose without removing anything from the library", () => {
    const el = render(<WorkoutPicker {...base} />);
    const select = el.querySelector("#pick-purpose") as HTMLSelectElement;
    act(() => {
      select.value = "recovery";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const shown = el.querySelectorAll("li").length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(LIBRARY.length);
    expect(el.textContent).toContain(`of ${LIBRARY.length} workouts`);
  });

  it("bounds the duration input by the workout's own flex range", () => {
    const el = render(<WorkoutPicker {...base} />);
    const first = el.querySelector("li button") as HTMLButtonElement;
    act(() => first.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = el.querySelector(
      'input[name="durationMins"]'
    ) as HTMLInputElement;
    const w = WORKOUTS[0];
    expect(input.min).toBe(String(w.minMins));
    expect(input.max).toBe(String(w.maxMins));
    expect(input.defaultValue).toBe(String(w.defaultMins));
  });

  it("carries the day and the athlete's local today into the form", () => {
    const el = render(<WorkoutPicker {...base} />);
    const first = el.querySelector("li button") as HTMLButtonElement;
    act(() => first.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const date = el.querySelector('input[name="date"]') as HTMLInputElement;
    const today = el.querySelector('input[name="today"]') as HTMLInputElement;
    expect(date.value).toBe("2026-09-10");
    expect(today.value).toBe("2026-09-08");
  });
});

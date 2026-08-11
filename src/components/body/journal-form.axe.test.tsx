// @vitest-environment jsdom
// See hero-readiness.axe.test.tsx for why matchers are registered by hand.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as matchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";
import { JournalForm } from "./journal-form";

expect.extend(matchers);

const baseProps = {
  syncedHrv: 55,
  syncedRhr: 48,
  syncedWeight: 72,
  syncedSleepHours: 7.5,
  streakDays: 4,
  entriesByDate: {},
  hasActiveConnection: true,
  usualTags: ["💧 Hydration"],
};

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

function mount(el: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
}

describe("JournalForm accessibility", () => {
  it("has no axe violations on a fresh (no-entry) day", async () => {
    mount(<JournalForm {...baseProps} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with manual vitals entry (no connection)", async () => {
    mount(<JournalForm {...baseProps} hasActiveConnection={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

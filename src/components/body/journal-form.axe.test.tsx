// @vitest-environment jsdom
// See hero-readiness.axe.test.tsx for why matchers are registered by hand.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as matchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";
import { JournalForm } from "./journal-form";
import { labelInName } from "@/test/label-in-name";

expect.extend(matchers);

const baseProps = {
  syncedHrv: 55,
  syncedRhr: 48,
  syncedWeight: 72,
  syncedSleepHours: 7.5,
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

  // axe's label-content-name-mismatch needs real layout, so axe() above
  // cannot see it in jsdom; labelInName mirrors the check. Each day button
  // shows a small label over the day number, and its name must contain both
  // in that order (WCAG 2.5.3, Label in Name).
  it("puts each day button's visible label inside its accessible name", () => {
    mount(<JournalForm {...baseProps} />);
    const buttons = Array.from(
      container.querySelectorAll(
        'section[aria-label="Choose the day to log"] button'
      )
    );
    expect(buttons).toHaveLength(5);
    for (const b of buttons) {
      expect(labelInName(b)).toMatchObject({ ok: true });
    }
    expect(labelInName(buttons[4]).name).toMatch(/^Log for Today \d{1,2}$/);
  });

  it("has no axe violations with manual vitals entry (no connection)", async () => {
    mount(<JournalForm {...baseProps} hasActiveConnection={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

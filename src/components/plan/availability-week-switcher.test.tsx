// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AvailabilityWeekSwitcher } from "./availability-week-switcher";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NEXT_MONDAY = "2026-08-03";

/**
 * Stands in for IntakeForm without pulling in its own dependencies
 * (BlockSheet, clearDayOverride, verdict copy). It only needs to prove two
 * things a real wrapped form would also need: the hidden `weekStart` field
 * the switcher hands it lands inside the form, and this component's own
 * local state (the stand-in for a half-entered day's blocks) is untouched
 * by the switcher re-rendering it with a new `weekStart` prop.
 */
function DummyAvailabilityForm({ weekStart }: { weekStart: string }) {
  const [note, setNote] = useState("");
  return (
    <form>
      <input type="hidden" name="weekStart" value={weekStart} />
      <input
        aria-label="Day note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </form>
  );
}

let root: Root | null = null;
let container: HTMLDivElement;

async function render(initialMode?: "this" | "next") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AvailabilityWeekSwitcher
        nextWeekStart={NEXT_MONDAY}
        initialMode={initialMode}
      >
        {(weekStart) => <DummyAvailabilityForm weekStart={weekStart} />}
      </AvailabilityWeekSwitcher>
    );
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
});

function weekStartValue(): string {
  const el = container.querySelector<HTMLInputElement>(
    'input[name="weekStart"]'
  );
  if (!el) throw new Error("no weekStart hidden input");
  return el.value;
}

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
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AvailabilityWeekSwitcher", () => {
  it("defaults to this week, leaving weekStart empty", async () => {
    await render();
    expect(weekStartValue()).toBe("");
  });

  it("sets weekStart to next Monday when toggled to Next week", async () => {
    await render();
    await click("Next week");
    expect(weekStartValue()).toBe(NEXT_MONDAY);
  });

  it("clears weekStart back to empty when toggled back to This week", async () => {
    await render();
    await click("Next week");
    expect(weekStartValue()).toBe(NEXT_MONDAY);
    await click("This week");
    expect(weekStartValue()).toBe("");
  });

  it("starts in next-week mode directly when ?availability=next drives initialMode", async () => {
    // The preview (Task 6) links to this state without duplicating the
    // control, so it must be reachable from a fresh page load, not only by
    // clicking.
    await render("next");
    expect(weekStartValue()).toBe(NEXT_MONDAY);
  });

  it("does not lose unsaved edits when switching weeks", async () => {
    await render();
    const noteInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Day note"]'
    )!;
    await set(noteInput, "half-entered edit");
    expect(noteInput.value).toBe("half-entered edit");

    await click("Next week");

    // Re-query: the switcher must not have re-mounted the wrapped form.
    const afterToggle = container.querySelector<HTMLInputElement>(
      '[aria-label="Day note"]'
    )!;
    expect(afterToggle.value).toBe("half-entered edit");
    expect(weekStartValue()).toBe(NEXT_MONDAY);
  });
});

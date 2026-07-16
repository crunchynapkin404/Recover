// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * v0.7 Part 1 — the journal must not invent subjective answers.
 *
 * The form previously initialized energy/soreness/stress to 7/4/4 and
 * submitted all three on every save, so ticking one behavior tag wrote three
 * numbers the athlete never gave — indistinguishable from real answers once
 * stored. These tests pin the contract at the submission boundary: the hidden
 * inputs are what actually reach the server action.
 *
 * Rendered with react-dom/client rather than @testing-library/react: that
 * library resolves its own React instance under Vitest, leaving the hook
 * dispatcher null. Everything needed here is plain DOM anyway.
 *
 * The action module is stubbed because it is "use server" — a genuine module
 * boundary, not the logic under test (the write path has its own DB tests).
 */
vi.mock("@/app/wellness/actions", () => ({
  logWellness: vi.fn(async () => ({ ok: true, message: "saved" })),
}));

import { JournalForm } from "@/components/journal/journal-form";

const baseProps = {
  syncedHrv: null,
  syncedRhr: null,
  syncedWeight: null,
  syncedSleepHours: null,
  streakDays: 0,
  entriesByDate: {},
};

let root: Root | null = null;
let container: HTMLDivElement;

async function renderForm(props: Partial<typeof baseProps> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<JournalForm {...baseProps} {...props} />);
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
});

const hidden = (name: string): HTMLInputElement => {
  const el = container.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${name}"]`
  );
  if (!el) throw new Error(`no hidden input named ${name}`);
  return el;
};

const byLabel = (label: string): HTMLInputElement | null =>
  container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);

/** Tap without moving the thumb — fires no change event, only pointerdown. */
async function tap(el: Element) {
  await act(async () => {
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
}

/** Drag to a new value: defeat React's value tracking, then fire input. */
async function slideTo(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("journal form — honest subjective input", () => {
  it("submits nothing for sliders the athlete never touched", async () => {
    await renderForm();

    // "" is what makes the action's zod preprocess skip the field entirely.
    expect(hidden("energy").value).toBe("");
    expect(hidden("soreness").value).toBe("");
    expect(hidden("stress").value).toBe("");
  });

  it("announces an untouched slider as not answered", async () => {
    await renderForm();

    // The accessible name is authoritative — the "—" is decorative.
    expect(byLabel("Energy: not answered")).not.toBeNull();
    expect(byLabel("Muscle Soreness: not answered")).not.toBeNull();
    expect(byLabel("Stress: not answered")).not.toBeNull();
  });

  it("keeps a deliberate tap on the resting value", async () => {
    await renderForm();
    const energy = byLabel("Energy: not answered")!;

    // The thumb already rests at 7, so tapping 7 fires no change event.
    // pointerdown must commit it, or a genuine answer is silently discarded.
    await tap(energy);

    expect(hidden("energy").value).toBe("7");
    expect(byLabel("Energy: 7 of 10")).not.toBeNull();
  });

  it("submits a moved slider's real value", async () => {
    await renderForm();

    await slideTo(byLabel("Muscle Soreness: not answered")!, "9");

    expect(hidden("soreness").value).toBe("9");
    expect(byLabel("Muscle Soreness: 9 of 10")).not.toBeNull();
  });

  it("only marks the touched slider as answered", async () => {
    await renderForm();

    await tap(byLabel("Energy: not answered")!);

    expect(hidden("energy").value).toBe("7");
    // Its neighbours stay unanswered — no blanket defaulting.
    expect(hidden("soreness").value).toBe("");
    expect(hidden("stress").value).toBe("");
  });

  it("shows a stored value as answered and its absence as unanswered", async () => {
    const today = new Date().toLocaleDateString("en-CA");
    await renderForm({
      entriesByDate: {
        [today]: {
          energy: 6,
          soreness: null,
          stress: null,
          mood: null,
          tags: null,
          dayFlags: null,
          notes: null,
        },
      },
    });

    expect(byLabel("Energy: 6 of 10")).not.toBeNull();
    expect(hidden("energy").value).toBe("6");
    // A past day with no stored value reads unanswered, not 4.
    expect(byLabel("Muscle Soreness: not answered")).not.toBeNull();
    expect(hidden("soreness").value).toBe("");
  });
});

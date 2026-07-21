// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Rendering by hand means opting into act() support ourselves — the flag a
// framework like @testing-library/react would set. Without it React warns and
// act() does not flush updates deterministically.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * v0.7 Part 1 — the journal must not invent subjective answers.
 *
 * The form previously initialized energy/soreness/stress to 7/4/4 and
 * submitted all three on every save, so ticking one behavior tag wrote three
 * numbers the athlete never gave — indistinguishable from real answers once
 * stored. These tests pin the contract at the submission boundary: the hidden
 * inputs are what actually reach the server action.
 *
 * Rendered with react-dom/client rather than @testing-library/react: the
 * assertions here are all plain DOM (hidden inputs and aria-labels), so the
 * library would add a dependency without adding reach.
 *
 * The action module is stubbed because it is "use server" — a genuine module
 * boundary, not the logic under test (the write path has its own DB tests).
 */
vi.mock("@/app/wellness/actions", () => ({
  logWellness: vi.fn(async () => ({ ok: true, message: "saved" })),
}));
// v0.20 — "Remember these as usual" writes here. Stubbed for the same
// use-server-is-a-module-boundary reason as logWellness above; its DB write
// path has its own coverage (see task-4-report.md).
vi.mock("@/app/journal/actions", () => ({
  setUsualBehaviorTags: vi.fn(async () => ({ ok: true })),
}));

import { JournalForm } from "@/components/journal/journal-form";
import { setUsualBehaviorTags } from "@/app/journal/actions";

const setUsualBehaviorTagsMock = vi.mocked(setUsualBehaviorTags);

const baseProps = {
  syncedHrv: null,
  syncedRhr: null,
  syncedWeight: null,
  syncedSleepHours: null,
  streakDays: 0,
  entriesByDate: {},
  hasActiveConnection: false,
  usualTags: [] as string[],
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
  vi.clearAllMocks();
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

const button = (text: string): HTMLButtonElement => {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text)
  );
  if (!btn) throw new Error(`no button found containing "${text}"`);
  return btn;
};

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * Steps 1–3 are wrapped in controlled Collapsibles (v0.19): only the active
 * step's panel is mounted. Clicking a step's header trigger — the same
 * interaction a user uses to jump back into an earlier step — opens it.
 */
async function openStep(headingText: string) {
  await click(button(headingText));
}

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
    await openStep("Wellness Sliders");

    // The accessible name is authoritative — the "—" is decorative.
    expect(byLabel("Energy: not answered")).not.toBeNull();
    expect(byLabel("Muscle Soreness: not answered")).not.toBeNull();
    expect(byLabel("Stress: not answered")).not.toBeNull();
  });

  it("keeps a deliberate tap on the resting value", async () => {
    await renderForm();
    await openStep("Wellness Sliders");
    const energy = byLabel("Energy: not answered")!;

    // The thumb already rests at 7, so tapping 7 fires no change event.
    // pointerdown must commit it, or a genuine answer is silently discarded.
    await tap(energy);

    expect(hidden("energy").value).toBe("7");
    expect(byLabel("Energy: 7 of 10")).not.toBeNull();
  });

  it("submits a moved slider's real value", async () => {
    await renderForm();
    await openStep("Wellness Sliders");

    await slideTo(byLabel("Muscle Soreness: not answered")!, "9");

    expect(hidden("soreness").value).toBe("9");
    expect(byLabel("Muscle Soreness: 9 of 10")).not.toBeNull();
  });

  it("only marks the touched slider as answered", async () => {
    await renderForm();
    await openStep("Wellness Sliders");

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
    await openStep("Wellness Sliders");

    expect(byLabel("Energy: 6 of 10")).not.toBeNull();
    expect(hidden("energy").value).toBe("6");
    // A past day with no stored value reads unanswered, not 4.
    expect(byLabel("Muscle Soreness: not answered")).not.toBeNull();
    expect(hidden("soreness").value).toBe("");
  });
});

/**
 * v0.19 — the stepper is a convenience wrapper (auto-advance on mood pick,
 * explicit Continue past the sliders) and must never itself become a way to
 * invent a subjective answer. These tests exercise the stepping mechanism
 * directly, distinct from the honesty-contract tests above which exercise
 * the sliders themselves.
 */
describe("journal form — stepped check-in", () => {
  it("step 2 (sliders) is not in the DOM until its step is entered", async () => {
    await renderForm();

    // Step 1 (Subjective Feeling) is open by default; step 2 is not mounted.
    expect(byLabel("Mood: happy")).not.toBeNull();
    expect(byLabel("Energy: not answered")).toBeNull();
  });

  it("picking a mood auto-advances to sliders without touching energy/soreness/stress", async () => {
    await renderForm();

    await click(byLabel("Mood: happy")!);

    // Mood is recorded and the sliders step is now open...
    expect(hidden("mood").value).toBe("happy");
    expect(byLabel("Energy: not answered")).not.toBeNull();
    // ...but none of the sliders were set on the athlete's behalf.
    expect(hidden("energy").value).toBe("");
    expect(hidden("soreness").value).toBe("");
    expect(hidden("stress").value).toBe("");
  });

  it("Continue advances to vitals regardless of whether a slider was touched", async () => {
    await renderForm();
    await openStep("Wellness Sliders");

    await click(button("Continue"));

    // Vitals step's manual inputs are now open; sliders panel is closed —
    // but no slider was forced to a resting value along the way.
    expect(hidden("energy").value).toBe("");
    expect(hidden("soreness").value).toBe("");
    expect(hidden("stress").value).toBe("");
    expect(container.querySelector("#manual-hrv")).not.toBeNull();
  });

  it("reopening a completed step preserves the other steps' entered values", async () => {
    await renderForm();

    // Complete step 1 (auto-advances to step 2).
    await click(byLabel("Mood: happy")!);
    // Move a real slider value in step 2.
    await slideTo(byLabel("Energy: not answered")!, "8");
    expect(hidden("energy").value).toBe("8");

    // Reopen step 1 to change the mood — its panel had unmounted.
    await openStep("Subjective Feeling");
    expect(byLabel("Mood: happy")).not.toBeNull();

    // Step 2's slider value survives even though its panel is now unmounted.
    expect(hidden("energy").value).toBe("8");
    expect(hidden("mood").value).toBe("happy");
  });
});

/**
 * v0.20 — default journal entries (behavioural pre-toggles).
 *
 * The regression guard: a saved "usual" set pre-checks behavior tags on a
 * fresh entry, and must never — under any circumstance — pre-fill or mark
 * answered the energy/soreness/stress sliders. That would resurrect the
 * exact fabricated-default bug v0.7 fixed (see the describe block above),
 * just moved to a different feature. Day flags ("Anything unusual today?")
 * and mood are also left untouched: a day flag defaulting to "on" would
 * contradict its own purpose of flagging something unusual.
 */
describe("journal form — usual behaviour pre-toggle (v0.20)", () => {
  it("pre-checks a saved usual behavior tag on a fresh entry, without touching the subjective sliders", async () => {
    await renderForm({ usualTags: ["💧 Hydration"] });

    expect(button("💧 Hydration").getAttribute("aria-pressed")).toBe("true");

    // The hard constraint: sliders remain in their real unanswered state —
    // the hidden inputs the form actually submits still carry "".
    expect(hidden("energy").value).toBe("");
    expect(hidden("soreness").value).toBe("");
    expect(hidden("stress").value).toBe("");

    await openStep("Wellness Sliders");
    expect(byLabel("Energy: not answered")).not.toBeNull();
    expect(byLabel("Muscle Soreness: not answered")).not.toBeNull();
    expect(byLabel("Stress: not answered")).not.toBeNull();
  });

  it("does not pre-check mood or day flags from a behavioural default", async () => {
    await renderForm({ usualTags: ["💧 Hydration"] });

    expect(hidden("mood").value).toBe("");
    for (const flag of ["Ill", "Travel", "Altitude"]) {
      expect(button(flag).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("does not apply the usual default once the day already has a real entry, even one with zero saved tags", async () => {
    const today = new Date().toLocaleDateString("en-CA");
    await renderForm({
      usualTags: ["💧 Hydration"],
      entriesByDate: {
        [today]: {
          energy: null,
          soreness: null,
          stress: null,
          mood: null,
          tags: [], // athlete already explicitly saved zero tags today
          dayFlags: null,
          notes: null,
        },
      },
    });

    expect(button("💧 Hydration").getAttribute("aria-pressed")).toBe("false");
  });

  it("with no usualTags supplied, behaves exactly as before (nothing pre-checked)", async () => {
    await renderForm({ usualTags: [] });
    expect(button("💧 Hydration").getAttribute("aria-pressed")).toBe("false");
  });

  it('"Remember these as usual" is a deliberate, separate action — saves only the currently active behavior tags', async () => {
    await renderForm();

    await click(button("☕ Caffeine"));
    expect(setUsualBehaviorTagsMock).not.toHaveBeenCalled();

    await click(button("Remember these as usual"));

    expect(setUsualBehaviorTagsMock).toHaveBeenCalledTimes(1);
    expect(setUsualBehaviorTagsMock).toHaveBeenCalledWith(["☕ Caffeine"]);
  });

  it("filling out one day's entry normally never calls the remember action on its own", async () => {
    await renderForm();

    await click(byLabel("Mood: happy")!);
    await openStep("Wellness Sliders");
    await slideTo(byLabel("Energy: not answered")!, "8");
    await click(button("☕ Caffeine"));

    expect(setUsualBehaviorTagsMock).not.toHaveBeenCalled();
  });
});

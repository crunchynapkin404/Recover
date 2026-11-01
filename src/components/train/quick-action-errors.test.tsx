// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { QuickState } from "@/app/plan/actions";
import { labelInName } from "@/test/label-in-name";
import { PlanStyleSwitch } from "./plan-style-switch";
import { SeasonModeSwitch } from "./season-mode-switch";

// The two Plan setup switches used to hand their server action straight to
// <form action>, which has to resolve to void — so a failed press (no active
// plan, a rejected value) looked exactly like a successful one. These drive
// a real submit through React's form-action path and read what the athlete
// would be told.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

async function render(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
  });
  return container;
}

afterEach(async () => {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
});

function button(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find(
    (b) => b.textContent === text
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

async function press(el: HTMLElement, text: string) {
  await act(async () => {
    button(el, text).click();
  });
}

function alertText(el: HTMLElement): string | null | undefined {
  return el.querySelector("[role='alert']")?.textContent;
}

describe.each([
  {
    name: "PlanStyleSwitch",
    target: "Block-lite",
    subject: "plan style",
    ui: (action: (s: QuickState, f: FormData) => Promise<QuickState>) => (
      <PlanStyleSwitch effectiveStyle="balanced" action={action} />
    ),
  },
  {
    name: "SeasonModeSwitch",
    target: "Off-season",
    subject: "season mode",
    ui: (action: (s: QuickState, f: FormData) => Promise<QuickState>) => (
      <SeasonModeSwitch
        effectiveSeasonMode="normal"
        reentryStage="none"
        action={action}
      />
    ),
  },
])("$name quick-action failures", ({ target, subject, ui }) => {
  // Present and empty before anything fails: a live region inserted
  // together with its text is not reliably announced, one whose text
  // changes is.
  it("renders an empty alert region before any press", async () => {
    const el = await render(ui(async () => ({ error: null })));
    expect(el.querySelectorAll("[role='alert']")).toHaveLength(1);
    expect(alertText(el)).toBe("");
  });

  it("tells the athlete a failed press changed nothing", async () => {
    const action = vi.fn(async () => ({ error: "style_update_failed" }));
    const el = await render(ui(action));
    await press(el, target);
    expect(action).toHaveBeenCalledTimes(1);
    expect(alertText(el)).toBe(
      `Couldn't change the ${subject}. Nothing was changed — try again.`
    );
  });

  it("names the missing plan instead of inviting a retry that cannot work", async () => {
    const el = await render(ui(async () => ({ error: "no_active_plan" })));
    await press(el, target);
    expect(alertText(el)).toBe(
      "There's no active plan to change. Nothing was changed."
    );
  });

  it("clears the message once a later press succeeds", async () => {
    let next: QuickState = { error: "style_update_failed" };
    const el = await render(ui(async () => next));
    await press(el, target);
    expect(alertText(el)).not.toBe("");
    next = { error: null };
    await press(el, target);
    expect(alertText(el)).toBe("");
  });

  // v0.141.0's Label in Name pass: a control's accessible name must contain
  // its visible text. The error must not be bolted onto the buttons' names.
  it("keeps every button's name equal to what it shows after a failure", async () => {
    const el = await render(ui(async () => ({ error: "no_active_plan" })));
    await press(el, target);
    for (const b of el.querySelectorAll("button")) {
      expect(b.hasAttribute("aria-label")).toBe(false);
      expect(labelInName(b)).toMatchObject({ ok: true });
    }
  });
});

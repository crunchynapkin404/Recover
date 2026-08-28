import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

// I5, final whole-branch review: `state.message` is the server's response
// to a real submission (e.g. "That week has already passed. Nothing was
// changed."), which `useActionState` only ever produces after a real form
// submit — unreachable from a single synchronous renderToString pass with
// the real hook. Mocked the same way oura-card.test.tsx/
// webhooks-card.test.tsx already mock `useActionState` for their own
// message-state cases: everything else from react stays the real
// implementation, only this one hook returns a configurable state.
let mockIntakeState: { message: string } = { message: "" };
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: vi.fn(() => [mockIntakeState, vi.fn(), false]),
  };
});

import { IntakeForm } from "./intake-form";

const resolved = Array.from({ length: 7 }, (_, i) =>
  i === 2
    ? [
        {
          start: "18:00",
          end: "19:30",
          mins: 90,
          energy: "normal" as const,
          sports: null,
        },
      ]
    : []
);
const noop = vi.fn();

afterEach(() => {
  // Every test but the one that sets it explicitly expects the initial,
  // no-submission-yet state — matching what the real hook returns on a
  // first render.
  mockIntakeState = { message: "" };
});

describe("IntakeForm", () => {
  it("carries each day's blocks into the form as JSON", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={[]}
        verdict={{ kind: "ok" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).toContain('name="blocks-2"');
  });

  it("badges a day that is pinned by an override", () => {
    const dates = [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ];
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={["2026-08-05"]}
        dates={dates}
        verdict={{ kind: "ok" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).toContain("Pinned");
  });

  it("shows the weekly total", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={[]}
        verdict={{ kind: "ok" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).toContain("1h 30m this week");
  });

  it("warns when the time given cannot hold fitness", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={[]}
        verdict={{ kind: "losing", maintenanceHrs: 6, projectedCtl: 57 }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).toContain("6h");
    expect(html).toContain("57");
  });

  it("says nothing at all when the verdict is silent", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={[]}
        verdict={{ kind: "silent" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).not.toContain("hold your fitness");
  });

  it("uses the token scale, not ad-hoc sizes or white alphas", () => {
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={["2026-08-05"]}
        dates={[
          "2026-08-03",
          "2026-08-04",
          "2026-08-05",
          "2026-08-06",
          "2026-08-07",
          "2026-08-08",
          "2026-08-09",
        ]}
        verdict={{ kind: "losing", maintenanceHrs: 6, projectedCtl: 57 }}
        sports={["Bike"]}
        action={noop}
      />
    );
    expect(html).not.toMatch(/text-\[[\d.]+px\]/);
    expect(html).not.toMatch(/\btext-(xs|sm)\b/);
    expect(html).not.toMatch(/text-white\//);
    expect(html).not.toMatch(/bg-white\//);
    expect(html).not.toMatch(/border-white\//);
  });

  it("renders the total/warning text before the day list, not after it", () => {
    // Found only by scrolling the real page (Task 6 report, "DOM-order
    // inversion"): PinnedAction's submit button is `sticky` and visually
    // floats ABOVE its natural flow position once stuck. The total/warning
    // paragraphs used to sit BETWEEN the day list and that button — their
    // own document position never moved, so once the button was hoisted
    // above them on screen, a fragment of that trailing text rendered
    // BELOW an already-drawn CTA. jsdom computes no layout, so it cannot
    // see that visual inversion at all — but it CAN see the ordering
    // decision that removes it outright: the total/warning text must
    // precede the day list in DOM order, so the list's closing `</ul>` is
    // always PinnedAction's immediate predecessor and there is nothing
    // left to invert.
    const dates = [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ];
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={dates}
        verdict={{ kind: "losing", maintenanceHrs: 6, projectedCtl: 57 }}
        sports={["Bike"]}
        action={noop}
      />
    );
    const totalIdx = html.indexOf("1h 30m");
    const warningIdx = html.indexOf("hold your fitness");
    const listOpenIdx = html.indexOf("<ul");
    const listCloseIdx = html.indexOf("</ul>");
    const buttonIdx = html.indexOf("Confirm week");
    expect(totalIdx).toBeGreaterThan(-1);
    expect(warningIdx).toBeGreaterThan(-1);
    expect(listOpenIdx).toBeGreaterThan(-1);
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(totalIdx).toBeLessThan(listOpenIdx);
    expect(warningIdx).toBeLessThan(listOpenIdx);
    expect(listCloseIdx).toBeLessThan(buttonIdx);
  });

  it("gives every focusable control in the day list scroll-mb-52", () => {
    // Found only by focusing the real last day-row control with the pinned
    // band engaged (Task 6 report, "focus-reachability defect"): the
    // control's raw bounding box already sat inside [0, viewportHeight],
    // so Chromium's native focus-scroll never engaged — it has no notion
    // that PinnedAction's higher-stacked (z-30), 95%-opaque band visually
    // covers it. jsdom computes no layout, so it cannot see a focused
    // element sitting behind an overlay — but it CAN see the class that
    // forces the extra scroll: `scroll-mb-52` is honoured by the same
    // focus-scroll algorithm regardless of layout. Every button in the day
    // list (the day toggle AND the "Pinned ×" unpin button) must carry it —
    // whichever one doesn't is the next silent regression of this bug.
    const dates = [
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ];
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={["2026-08-05"]}
        dates={dates}
        verdict={{ kind: "ok" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    const listHtml = html.slice(html.indexOf("<ul"), html.indexOf("</ul>"));
    const buttonCount = (listHtml.match(/<button/g) ?? []).length;
    const scrollMbCount = (listHtml.match(/scroll-mb-52/g) ?? []).length;
    // 7 day-toggle buttons + 1 "Pinned ×" unpin button for the one
    // overridden date above.
    expect(buttonCount).toBe(8);
    expect(scrollMbCount).toBe(buttonCount);
  });

  // I5, final whole-branch review: Task 6 moved the total/warning text
  // above the day list to fix the DOM-order inversion above (see that
  // test's comment) — the day list's closing `</ul>` became PinnedAction's
  // immediate predecessor. `state.message`, the one piece of text a failed
  // submission actually needs the athlete to read (e.g. "That week has
  // already passed. Nothing was changed."), was left AFTER PinnedAction —
  // the exact position Task 6 just finished proving is wrong, off-screen
  // in precisely the scroll state that makes the button sticky.
  it("renders the result message before PinnedAction, not after it", () => {
    mockIntakeState = {
      message: "That week has already passed. Nothing was changed.",
    };
    const html = renderToString(
      <IntakeForm
        resolved={resolved}
        overrideDates={[]}
        dates={[]}
        verdict={{ kind: "ok" }}
        sports={["Bike"]}
        action={noop}
      />
    );
    const messageIdx = html.indexOf("That week has already passed");
    const listOpenIdx = html.indexOf("<ul");
    const listCloseIdx = html.indexOf("</ul>");
    const buttonIdx = html.indexOf("Confirm week");
    expect(messageIdx).toBeGreaterThan(-1);
    expect(listOpenIdx).toBeGreaterThan(-1);
    expect(listCloseIdx).toBeGreaterThan(-1);
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(messageIdx).toBeLessThan(buttonIdx);
    // Not just "before the button" — before the day list too, keeping the
    // Task 6 invariant intact: `</ul>` stays PinnedAction's immediate DOM
    // predecessor, with nothing reintroduced between them.
    expect(messageIdx).toBeLessThan(listOpenIdx);
    expect(listCloseIdx).toBeLessThan(buttonIdx);
  });
});

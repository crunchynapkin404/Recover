// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * Task 6 — Settings "Backfill full history" button.
 *
 * `backfillHistory` (Task 5) enqueues a sync_jobs row and returns instantly;
 * the job itself runs for minutes in the background. These tests pin two
 * things a naive implementation gets wrong:
 *
 *  1. The disabled/"Backfilling…" state is driven by the `backfillRunning`
 *     prop (real job state from the page's sync_jobs query), not local
 *     component state — a button that only disables during the action's own
 *     transition re-enables seconds later and invites a second click.
 *  2. The recovery-scores-may-shift warning is present in the rendered
 *     output, not just in a changelog.
 *
 * Rendered with react-dom/client per tests/journal-form.test.tsx and
 * tests/webhooks-card.test.tsx: no DB, and @testing-library/react is not a
 * dependency of this repo.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// "use server" module — a genuine module boundary, not the logic under test.
vi.mock("@/app/settings/actions", () => ({
  connectIntervals: vi.fn(),
  disconnectIntervals: vi.fn(),
  syncNow: vi.fn(),
  setWellnessPollInterval: vi.fn(),
  backfillHistory: vi.fn(),
}));

import { IntervalsCard } from "@/components/settings/intervals-card";

let root: Root | null = null;
let container: HTMLDivElement;

function render(connection: Parameters<typeof IntervalsCard>[0]["connection"]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<IntervalsCard connection={connection} />);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  vi.clearAllMocks();
});

const connection = {
  athleteName: "Test Athlete",
  status: "active" as const,
  lastSyncAt: null,
  lastError: null,
  wellnessPollIntervalMin: 30,
  lastWellnessPollAt: null,
  backfillRunning: false,
};

function findButton(pattern: RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    pattern.test(b.textContent ?? "")
  );
}

describe("IntervalsCard backfill control", () => {
  it("offers a backfill button when connected", () => {
    render(connection);
    const btn = findButton(/backfill full history/i);
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(false);
  });

  it("warns that recovery scores will shift", () => {
    render(connection);
    expect(container.textContent).toMatch(/recovery scores may shift/i);
  });

  it("disables and relabels the button while a backfill is running", () => {
    render({ ...connection, backfillRunning: true });
    const btn = findButton(/backfilling/i);
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(true);
  });

  it("shows no backfill control when not connected", () => {
    render(null);
    expect(findButton(/backfill/i)).toBeUndefined();
  });
});

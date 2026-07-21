// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Task 20 — webhook delivery-status visibility.
 *
 * The v0.20 design spec commits that webhook "deliveries retry and failures
 * are visible" (docs/specs/2026-07-21-v0.20-final-sweep-design.md:106).
 * Retry shipped; visibility did not — webhook_deliveries rows were written
 * but surfaced nowhere in the settings UI. This is a pure-props render test
 * (no DB) so it runs unconditionally in CI: a regression that dropped
 * lastDelivery rendering would fail it.
 *
 * The action module is stubbed for the same use-server-is-a-module-boundary
 * reason as journal-form.test.tsx's stubs — the write paths have their own
 * coverage; what's under test here is purely how `lastDelivery` renders.
 */
vi.mock("@/app/settings/webhook-actions", () => ({
  createWebhookSubscription: vi.fn(async () => ({ ok: true, message: "" })),
  revokeWebhookSubscription: vi.fn(async () => ({ ok: true, message: "" })),
}));

import { WebhooksCard } from "@/components/settings/webhooks-card";

let root: Root | null = null;
let container: HTMLDivElement;

function render(webhooks: Parameters<typeof WebhooksCard>[0]["webhooks"]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<WebhooksCard webhooks={webhooks} />);
  });
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  vi.clearAllMocks();
});

describe("WebhooksCard — last delivery status (task 20)", () => {
  it("renders all three delivery states from one set of props", () => {
    const now = Date.now();

    render([
      {
        id: "sub-none",
        url: "https://example.com/none",
        events: ["readiness_computed"],
        createdAt: new Date(now).toISOString(),
        lastDelivery: null,
      },
      {
        id: "sub-success",
        url: "https://example.com/success",
        events: ["band_changed"],
        createdAt: new Date(now).toISOString(),
        lastDelivery: {
          status: "success",
          attempts: 1,
          at: new Date(now - 5 * 60 * 1000).toISOString(), // 5 minutes ago
          lastError: null,
        },
      },
      {
        id: "sub-failed",
        url: "https://example.com/failed",
        events: ["backup_completed"],
        createdAt: new Date(now).toISOString(),
        lastDelivery: {
          status: "failed",
          attempts: 4,
          at: new Date(now - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
          lastError: "connect ECONNREFUSED 127.0.0.1:9999",
        },
      },
    ]);

    // No deliveries yet — muted, not an error state.
    expect(container.textContent).toContain("No deliveries yet");

    // Success — "Delivered" plus a relative time, not a destructive color.
    expect(container.textContent).toContain("Delivered");
    expect(container.textContent).toContain("5m ago");

    // Failure — attempt count, relative time, and the underlying error are
    // all present in the DOM (not just visually truncated away).
    expect(container.textContent).toContain("Failed after 4 attempts");
    expect(container.textContent).toContain("2h ago");
    expect(container.textContent).toContain(
      "connect ECONNREFUSED 127.0.0.1:9999"
    );

    // Accessibility: the failure line must use text-destructive, never a
    // low-opacity class like text-white/40 (the final review's WCAG AA
    // finding this task closes).
    const failedLine = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent?.startsWith("Failed after 4 attempt")
    );
    expect(failedLine).toBeTruthy();
    expect(failedLine!.className).toContain("text-destructive");
    expect(failedLine!.className).not.toContain("text-white/40");
    expect(failedLine!.className).not.toMatch(/text-white\/\d+/);
  });

  it("shows a bare success line with no attempts/error noise", () => {
    render([
      {
        id: "sub-success",
        url: "https://example.com/success",
        events: ["readiness_computed"],
        createdAt: new Date().toISOString(),
        lastDelivery: {
          status: "success",
          attempts: 1,
          at: new Date().toISOString(),
          lastError: null,
        },
      },
    ]);

    expect(container.textContent).toContain("Delivered");
    expect(container.textContent).not.toContain("Failed");
  });
});

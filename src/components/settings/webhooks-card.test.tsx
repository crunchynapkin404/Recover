// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const { mockActionState, mockCreateWebhookSubscription, mockRevokeWebhookSubscription } =
  vi.hoisted(() => ({
    mockActionState: { ok: true, secret: "top-secret", message: "ok" },
    mockCreateWebhookSubscription: vi.fn(),
    mockRevokeWebhookSubscription: vi.fn(),
  }));

vi.mock("@/app/settings/webhook-actions", () => ({
  createWebhookSubscription: mockCreateWebhookSubscription,
  revokeWebhookSubscription: mockRevokeWebhookSubscription,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useActionState: vi.fn(() => [mockActionState, mockCreateWebhookSubscription, false]),
  };
});

import { WebhooksCard } from "./webhooks-card";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebhooksCard", () => {
  it("renders the newly created secret directly from the action result", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(<WebhooksCard webhooks={[]} />);
    });

    expect(container.textContent).toContain("top-secret");
    expect(container.textContent).toContain("Copy this secret now");

    act(() => root.unmount());
    container.remove();
  });
});

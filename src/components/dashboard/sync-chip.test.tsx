// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { SyncChip } from "./sync-chip";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SyncChip", () => {
  it("resolves to the relative sync time once mounted (no stuck placeholder)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(<SyncChip lastSyncAt={new Date().toISOString()} />);
    });

    // act() flushes the mount effect, so by here the placeholder "…" must
    // already have resolved to a real relative-time string.
    expect(container.textContent).toContain("Synced just now");
    expect(container.textContent).not.toContain("…");

    act(() => root.unmount());
    container.remove();
  });

  it("shows 'never' when there is no last sync", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(<SyncChip lastSyncAt={null} />);
    });

    expect(container.textContent).toContain("Synced never");

    act(() => root.unmount());
    container.remove();
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AvailabilitySheet } from "./availability-sheet";

describe("AvailabilitySheet", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);

    // Mock scrollTo for jsdom environment
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
  });

  it("tapping a preset chip calls onChange with that value", () => {
    const onChange = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(
        <AvailabilitySheet
          dayLabel="Wednesday"
          mins={0}
          onChange={onChange}
          onClose={() => {}}
        />
      );
    });

    const chip = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "1h 30m"
    );
    expect(chip).toBeTruthy();

    act(() => {
      chip!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(90);
  });

  it("tapping the backdrop calls onClose without calling onChange", () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(
        <AvailabilitySheet
          dayLabel="Wednesday"
          mins={0}
          onChange={onChange}
          onClose={onClose}
        />
      );
    });

    const backdrop = container.querySelector('button[aria-label="Close"]');
    expect(backdrop).toBeTruthy();

    act(() => {
      backdrop!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables the minutes wheel at the 12h ceiling", () => {
    act(() => {
      root = createRoot(container);
      root.render(
        <AvailabilitySheet
          dayLabel="Wednesday"
          mins={720}
          onChange={vi.fn()}
          onClose={() => {}}
        />
      );
    });

    const minutesCol = container.querySelector('[aria-label="Minutes"]');
    expect(minutesCol?.getAttribute("aria-disabled")).toBe("true");
  });

  it("clicking a wheel option jumps directly to that value", () => {
    const onChange = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(
        <AvailabilitySheet
          dayLabel="Wednesday"
          mins={0}
          onChange={onChange}
          onClose={() => {}}
        />
      );
    });

    const hoursCol = container.querySelector('[aria-label="Hours"]');
    const option = Array.from(hoursCol!.querySelectorAll('[role="option"]')).find(
      (el) => el.textContent === "02"
    );
    expect(option).toBeTruthy();

    act(() => {
      option!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(120); // 2 hours, 0 minutes
  });
});

// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { IntakeForm } from "./intake-form";

// Mock scrollTo for jsdom
Element.prototype.scrollTo = vi.fn();

const suggested = [0, 60, 45, 0, 90, 120, 150];

const noopAction = async () => ({ message: "" });

describe("intake form (static render)", () => {
  it("renders 7 hidden inputs prefilled from the suggested minutes", () => {
    const html = renderToString(
      <IntakeForm suggested={suggested} action={noopAction} />
    );
    const inputs = html.match(/name="mins-\d"/g) ?? [];
    expect(inputs).toHaveLength(7);
    expect(html).toContain('value="150"');
    expect(html).toContain('value="90"');
  });

  it("shows each day's value as formatted pill text", () => {
    const html = renderToString(
      <IntakeForm suggested={suggested} action={noopAction} />
    );
    expect(html).toContain("Rest"); // Mon and Thu are 0
    expect(html).toContain("45m"); // Wed
    expect(html).toContain("1h 30m"); // Fri
  });

  it("shows the live weekly total", () => {
    const html = renderToString(
      <IntakeForm suggested={suggested} action={noopAction} />
    );
    // 0+60+45+0+90+120+150 = 465 mins = 7h 45m
    expect(html).toContain("7h 45m");
  });

  it("submit button is labelled Confirm week", () => {
    const html = renderToString(
      <IntakeForm suggested={suggested} action={noopAction} />
    );
    expect(html).toContain("Confirm week");
  });
});

describe("intake form (interaction)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("tapping a day pill opens the sheet for that day, and a preset chip updates the pill, hidden input, and total", () => {
    act(() => {
      root = createRoot(container);
      root.render(<IntakeForm suggested={suggested} action={noopAction} />);
    });

    // Wednesday is index 2 — currently "45m", no dialog open yet.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const pills = container.querySelectorAll('.grid button[type="button"]');
    expect(pills).toHaveLength(7);

    act(() => {
      pills[2].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("Wednesday");

    const chip = Array.from(
      container.querySelectorAll('[role="dialog"] button')
    ).find((b) => b.textContent === "1h 30m");
    expect(chip).toBeTruthy();

    act(() => {
      chip!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(pills[2].textContent).toBe("1h 30m");
    const hidden = container.querySelector(
      'input[name="mins-2"]'
    ) as HTMLInputElement;
    expect(hidden.value).toBe("90");
    // total was 7h45m (465), Wed moved 45 -> 90 (+45) = 510 = 8h 30m
    expect(container.textContent).toContain("8h 30m");
  });
});

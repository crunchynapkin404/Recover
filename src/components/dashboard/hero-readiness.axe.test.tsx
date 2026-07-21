// @vitest-environment jsdom
//
// vitest-axe (0.1.0, last published years ago) ships a broken/empty
// `vitest-axe/extend-expect` entry point for this Vitest version — importing
// it registers nothing and `toHaveNoViolations` throws "Invalid Chai
// property". The matchers themselves (`vitest-axe/matchers`) work fine, so
// register them by hand instead. See docs/a11y-sweep-2026-07.md.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as matchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";
import { HeroReadiness } from "./hero-readiness";

expect.extend(matchers);

const base = {
  readiness: 72,
  band: "green" as const,
  recoveryScore: 65,
  strainFraction: 40,
  sleepScore: 88,
  loadCalibrating: false,
  loadComputed: true,
};

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

function mount(el: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(el);
  });
}

describe("HeroReadiness accessibility", () => {
  it("has no axe violations for a normal reading", async () => {
    mount(<HeroReadiness {...base} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations while calibrating (dash fallbacks)", async () => {
    mount(
      <HeroReadiness
        {...base}
        band="calibrating"
        loadCalibrating
        loadComputed={false}
        recoveryScore={0}
        strainFraction={0}
        sleepScore={null}
      />
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

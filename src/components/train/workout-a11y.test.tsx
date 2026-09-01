// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import * as matchers from "vitest-axe/matchers";
import { axe } from "vitest-axe";
import { renderToString } from "react-dom/server";
import { WorkoutProfile } from "./workout-profile";
import { LIBRARY } from "@/lib/interval/library";
import { renderProfile } from "@/lib/interval/render-profile";
import { renderDescription } from "@/lib/interval/render-description";

expect.extend(matchers);

/**
 * The capture pipeline's axe ratchet only sees surfaces its fixtures actually
 * produce, and nothing guarantees a seeded demo week contains a cycling day
 * the library answers. So the new chart is checked directly here rather than
 * hoped for — an SVG with no accessible name is exactly the kind of thing a
 * zero-violation report can miss by never rendering it.
 */
describe("the workout profile is accessible", () => {
  it("has no axe violations, for every workout in the library", async () => {
    for (const w of LIBRARY) {
      const html = renderToString(
        <WorkoutProfile
          bars={renderProfile(w.blocks)}
          label={renderDescription(w.blocks)}
        />
      );
      const el = document.createElement("div");
      el.innerHTML = html;
      document.body.appendChild(el);
      expect(await axe(el), `${w.id} has violations`).toHaveNoViolations();
      el.remove();
    }
  });

  it("gives every profile a non-empty accessible name", async () => {
    // role="img" with no name is an unlabelled image to a screen reader.
    for (const w of LIBRARY) {
      const html = renderToString(
        <WorkoutProfile
          bars={renderProfile(w.blocks)}
          label={renderDescription(w.blocks)}
        />
      );
      const label = /aria-label="([^"]*)"/.exec(html)?.[1] ?? "";
      expect(label.length, `${w.id} has an empty aria-label`).toBeGreaterThan(
        0
      );
    }
  });
});

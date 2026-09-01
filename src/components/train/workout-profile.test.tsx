import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WorkoutProfile } from "./workout-profile";
import { renderProfile } from "@/lib/interval/render-profile";
import type { Block } from "@/lib/interval/types";

const SS: Block[] = [
  {
    name: "Warmup",
    repeat: 1,
    steps: [{ secs: 600, lo: 50, hi: 65, ramp: true }],
  },
  {
    name: "Main set",
    repeat: 3,
    steps: [
      { secs: 720, lo: 88, hi: 93 },
      { secs: 300, lo: 55, hi: 55 },
    ],
  },
  { name: "Cooldown", repeat: 1, steps: [{ secs: 540, lo: 50, hi: 50 }] },
];

const count = (html: string, tag: string) =>
  (html.match(new RegExp(`<${tag}\\b`, "g")) ?? []).length;

describe("WorkoutProfile", () => {
  it("draws one shape per rendered step, repeats unrolled", () => {
    // 1 warmup + 3 x 2 main + 1 cooldown = 8. A repeat drawn once would show
    // a 70-minute workout as 25 minutes of bars.
    const html = renderToString(
      <WorkoutProfile bars={renderProfile(SS)} label="x" />
    );
    expect(count(html, "rect") + count(html, "polygon")).toBe(8);
  });

  it("draws a ramp as a trapezoid, not a flat bar", () => {
    const html = renderToString(
      <WorkoutProfile bars={renderProfile(SS)} label="x" />
    );
    expect(count(html, "polygon")).toBe(1);
    expect(count(html, "rect")).toBe(7);
  });

  it("names itself with the derived description", () => {
    // The accessible name and the bars come from the same blocks, so they
    // cannot drift.
    const html = renderToString(
      <WorkoutProfile
        bars={renderProfile(SS)}
        label="3 × 12 min at 88–93% FTP, 5 min recovery"
      />
    );
    expect(html).toContain('role="img"');
    expect(html).toContain("3 × 12 min at 88–93% FTP, 5 min recovery");
  });

  it("renders nothing at all when there are no bars", () => {
    expect(renderToString(<WorkoutProfile bars={[]} label="x" />)).toBe("");
  });

  it("keeps a supra-ceiling target inside the viewBox", () => {
    // A 30/30 touches 125% against a 130% ceiling; a taller target must clip
    // rather than draw above the chart and be cropped invisibly.
    const html = renderToString(
      <WorkoutProfile
        bars={renderProfile([
          { name: "X", repeat: 1, steps: [{ secs: 60, lo: 200, hi: 200 }] },
        ])}
        label="x"
      />
    );
    const y = Number(/y="([-\d.]+)"/.exec(html)?.[1]);
    expect(y).toBeGreaterThanOrEqual(0);
  });
});

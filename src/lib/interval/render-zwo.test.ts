import { describe, it, expect } from "vitest";
import { renderZwo } from "./render-zwo";
import type { LibraryWorkout } from "./types";

const W: LibraryWorkout = {
  id: "ss-3x12",
  name: "Sweet Spot 3×12",
  purpose: "threshold",
  family: "sweet-spot",
  why: "Three long blocks just under threshold.",
  source:
    "Coaching convention. Confidence: Low — no trial compares block lengths at this intensity.",
  blocks: [
    {
      name: "Warmup",
      repeat: 1,
      steps: [{ secs: 600, lo: 50, hi: 65, ramp: true }],
    },
    {
      name: "Main set",
      repeat: 3,
      steps: [
        { secs: 720, lo: 88, hi: 93, rpm: 90 },
        { secs: 300, lo: 55, hi: 55 },
      ],
    },
    { name: "Cooldown", repeat: 1, steps: [{ secs: 540, lo: 50, hi: 50 }] },
  ],
};

describe("renderZwo", () => {
  it("writes powers as fractions of FTP, not percentages", () => {
    const xml = renderZwo(W);
    expect(xml).toContain('Power="0.55"');
    expect(xml).toContain('PowerLow="0.5"');
    expect(xml).toContain('PowerHigh="0.65"');
    expect(xml).not.toContain('Power="55"');
  });

  it("unrolls a repeat rather than emitting IntervalsT", () => {
    const xml = renderZwo(W);
    expect(xml).not.toContain("IntervalsT");
    // 3 repeats x 2 steps = 6 elements from the main set, plus warmup and
    // cooldown = 8 total.
    expect((xml.match(/<(SteadyState|Ramp)\b/g) ?? []).length).toBe(8);
  });

  it("carries the name and the coaching intent into the header", () => {
    const xml = renderZwo(W);
    expect(xml).toContain("<name>Sweet Spot 3×12</name>");
    expect(xml).toContain("Three long blocks just under threshold.");
    expect(xml).toContain("<sportType>bike</sportType>");
  });

  it("escapes XML metacharacters in authored text", () => {
    // A workout named with an ampersand must not produce invalid XML.
    const xml = renderZwo({ ...W, name: "Over & Under" });
    expect(xml).toContain("<name>Over &amp; Under</name>");
  });

  it("emits a Ramp element for a ramped step and SteadyState otherwise", () => {
    const xml = renderZwo(W);
    expect(xml).toContain('<Ramp Duration="600"');
    expect(xml).toContain('<SteadyState Duration="720"');
  });

  it("carries cadence when the step has one", () => {
    expect(renderZwo(W)).toContain('Cadence="90"');
  });
});

import { describe, it, expect } from "vitest";
import { renderIcu } from "./render-icu";
import type { Block } from "./types";

const SS_3X12: Block[] = [
  {
    name: "Warmup",
    repeat: 1,
    steps: [
      { secs: 600, lo: 50, hi: 65, ramp: true },
      { secs: 180, lo: 75, hi: 75 },
      { secs: 120, lo: 55, hi: 55 },
    ],
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
];

describe("renderIcu", () => {
  it("renders sections, repeats, ranges, ramps and cadence", () => {
    expect(renderIcu(SS_3X12)).toBe(
      [
        "Warmup",
        "- 10m ramp 50%-65%",
        "- 3m 75%",
        "- 2m 55%",
        "",
        "Main set 3x",
        "- 12m 88-93% 90rpm",
        "- 5m 55%",
        "",
        "Cooldown",
        "- 9m 50%",
      ].join("\n")
    );
  });

  it("writes a point target without a range", () => {
    // lo === hi is a point target: "50%", never "50-50%".
    expect(
      renderIcu([
        { name: "X", repeat: 1, steps: [{ secs: 60, lo: 50, hi: 50 }] },
      ])
    ).toContain("- 1m 50%");
  });

  it("writes sub-minute and mixed durations the way the spec defines them", () => {
    const b: Block[] = [
      {
        name: "X",
        repeat: 1,
        steps: [
          { secs: 30, lo: 100, hi: 100 },
          { secs: 90, lo: 60, hi: 60 },
          { secs: 3600, lo: 55, hi: 55 },
        ],
      },
    ];
    const out = renderIcu(b);
    expect(out).toContain("- 30s 100%");
    expect(out).toContain("- 1m30s 60%");
    expect(out).toContain("- 1h 55%");
  });

  it("never emits a minutes count that the syntax reads as metres", () => {
    // get-workout-syntax.ts defines `Xm` TWICE: minutes, and — in the
    // distance table — "Meters (context-dependent, >200 = meters)". A long
    // ride's endurance body is the flex step and routinely exceeds 200
    // minutes, so `210m` would export as a 210-METRE step. Above an hour we
    // use the syntax's own `XhYm` form, which has no such collision.
    const long = (secs: number): string =>
      renderIcu([
        { name: "Endurance", repeat: 1, steps: [{ secs, lo: 60, hi: 70 }] },
      ]);
    expect(long(12600)).toContain("- 3h30m 60-70%");
    expect(long(14400)).toContain("- 4h 60-70%");
    for (const secs of [10800, 12000, 12600, 14400, 21600]) {
      expect(long(secs)).not.toMatch(/- \d{3,}m /);
    }
  });

  it("omits the repeat suffix for a plain section", () => {
    // "Warmup", never "Warmup 1x" — the syntax has no such form.
    // startsWith, not toContain("\nWarmup\n"): Warmup is the FIRST block, so
    // there is no newline before it.
    expect(renderIcu(SS_3X12).startsWith("Warmup\n")).toBe(true);
    expect(renderIcu(SS_3X12)).not.toContain("1x");
  });
});

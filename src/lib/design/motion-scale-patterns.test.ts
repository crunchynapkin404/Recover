import { describe, it, expect } from "vitest";
import {
  HANDWRITTEN_MOTION,
  TRANSITION_ALL,
  NUMERIC_DURATION,
} from "./motion-scale-patterns";

/** Regexes carry `g`, so lastIndex must not leak between assertions. */
const hits = (re: RegExp, s: string) =>
  s.match(new RegExp(re.source, "g")) ?? [];

describe("HANDWRITTEN_MOTION", () => {
  it("catches both spellings of one duration", () => {
    expect(
      hits(HANDWRITTEN_MOTION, "animation: sheet-up 300ms ease;")
    ).toContain("300ms");
    expect(
      hits(HANDWRITTEN_MOTION, "transition: height 0.3s ease-out;")
    ).toContain("0.3s");
  });

  it("catches raw cubic-bezier curves", () => {
    expect(
      hits(
        HANDWRITTEN_MOTION,
        "transition: all 0.7s cubic-bezier(0.21, 1.02, 0.49, 1);"
      )
    ).toContain("cubic-bezier(0.21, 1.02, 0.49, 1)");
  });

  it("does not count a var() reference to a token", () => {
    expect(
      hits(
        HANDWRITTEN_MOTION,
        "animation: sheet-up var(--duration-transition) var(--ease-settle);"
      )
    ).toEqual([]);
  });

  it("does not count the token declarations themselves", () => {
    // The scan excludes the @theme block before applying this pattern, but
    // the pattern must also not fire on a declaration line if it ever sees
    // one — a guard that flags its own scale is a guard nobody can satisfy.
    expect(hits(HANDWRITTEN_MOTION, "  --duration-transition: 320ms;")).toEqual(
      []
    );
    // The easing half needs its own lookbehind, and needs its own assertion:
    // the caller strips the @theme block before scanning, so a gap here would
    // never show up in the guard's counts — it would just sit there until
    // someone reused the pattern somewhere that does not strip.
    expect(
      hits(
        HANDWRITTEN_MOTION,
        "  --ease-settle: cubic-bezier(0.21, 1.02, 0.49, 1);"
      )
    ).toEqual([]);
  });

  it("does not count non-motion numbers that happen to end in s", () => {
    expect(
      hits(HANDWRITTEN_MOTION, "grid-template-columns: repeat(3, 1fr);")
    ).toEqual([]);
    expect(hits(HANDWRITTEN_MOTION, "flex: 1 1 0%;")).toEqual([]);
  });
});

describe("TRANSITION_ALL", () => {
  it("catches the utility", () => {
    expect(
      hits(TRANSITION_ALL, 'className="transition-all duration-300"')
    ).toEqual(["transition-all"]);
  });

  it("does not catch the other transition utilities", () => {
    expect(
      hits(TRANSITION_ALL, 'className="transition-colors transition-opacity"')
    ).toEqual([]);
  });
});

describe("NUMERIC_DURATION", () => {
  it("catches Tailwind's numeric duration utilities", () => {
    expect(hits(NUMERIC_DURATION, 'className="duration-300"')).toEqual([
      "duration-300",
    ]);
  });

  it("does not catch a token-named duration utility", () => {
    expect(hits(NUMERIC_DURATION, 'className="duration-transition"')).toEqual(
      []
    );
  });
});

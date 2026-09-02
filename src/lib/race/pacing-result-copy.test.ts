import { describe, expect, it } from "vitest";
import { describePacingResult, fmtPace } from "./pacing-result-copy";
import type { PacingComparison } from "./pacing-result";

const bike: Extract<PacingComparison, { sport: "Bike" }> = {
  sport: "Bike",
  targetWatts: 208,
  lowWatts: 198,
  highWatts: 218,
  actualWatts: 214,
  deltaWatts: 6,
  deltaPct: 2.9,
  verdict: "inside",
  raceDistanceKm: 90,
  actualDistanceKm: 90.4,
};

const run: Extract<PacingComparison, { sport: "Run" }> = {
  sport: "Run",
  targetSecPerKm: 285,
  lowSecPerKm: 271,
  highSecPerKm: 299,
  actualSecPerKm: 278,
  deltaSecPerKm: -7,
  deltaPct: -2.5,
  verdict: "inside",
  raceDistanceKm: 21.1,
  actualDistanceKm: 21.2,
};

describe("fmtPace", () => {
  it("renders seconds per km as m:ss/km", () => {
    expect(fmtPace(285)).toBe("4:45/km");
    expect(fmtPace(300)).toBe("5:00/km");
  });

  it("pads the seconds, so 4:05 never renders as 4:5", () => {
    expect(fmtPace(245)).toBe("4:05/km");
  });
});

describe("describePacingResult — Bike", () => {
  it("names the target, the band, what was held, and the verdict", () => {
    const s = describePacingResult(bike);
    expect(s).toContain("208 W");
    expect(s).toContain("198–218");
    expect(s).toContain("214 W");
    expect(s).toContain("inside");
  });

  it("signs the delta so a reader can see the direction without arithmetic", () => {
    expect(describePacingResult({ ...bike, verdict: "harder" })).toContain(
      "+2.9%"
    );
    expect(
      describePacingResult({
        ...bike,
        actualWatts: 190,
        deltaWatts: -18,
        deltaPct: -8.7,
        verdict: "easier",
      })
    ).toContain("−8.7%");
  });
});

describe("describePacingResult — Run", () => {
  it("renders paces as m:ss/km, never as raw seconds", () => {
    const s = describePacingResult(run);
    expect(s).toContain("4:45/km");
    expect(s).toContain("4:38/km");
    expect(s).not.toMatch(/\b285\b|\b278\b/);
  });

  /**
   * THE COPY DEFECT THIS FILE EXISTS FOR. For a run the raw delta runs
   * OPPOSITE to the effort: -7 s/km is FASTER, which is HARDER. A sentence
   * that renders "−7 s/km" next to the word "easier" — or that lets a reader
   * infer the direction from the sign — reads backwards to every runner.
   * The verdict is the word that carries, and it is stated, not implied.
   */
  it("states the verdict in words, so the delta's sign cannot mislead", () => {
    const harder = describePacingResult({ ...run, verdict: "harder" });
    expect(harder).toContain("harder");
    // The pace delta is negative here and that is correct — faster. What must
    // not happen is the sentence implying "easier" from that sign.
    expect(harder).not.toContain("easier");
  });

  it("describes a slower run as easier, with the sign the other way", () => {
    const s = describePacingResult({
      ...run,
      actualSecPerKm: 310,
      deltaSecPerKm: 25,
      deltaPct: 8.8,
      verdict: "easier",
    });
    expect(s).toContain("easier");
    expect(s).not.toContain("harder");
  });

  it("never prints a bare seconds-per-km delta for a run", () => {
    // "+25 s/km" is technically true and reads as "harder" to anyone who has
    // not been told the convention. The percentage carries the same
    // information without inviting that reading.
    for (const v of ["harder", "inside", "easier"] as const) {
      expect(describePacingResult({ ...run, verdict: v })).not.toMatch(
        /s\/km(?!\))/
      );
    }
  });
});

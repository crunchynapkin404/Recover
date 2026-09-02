import { describe, expect, it } from "vitest";
import { Figure } from "@/lib/uncertainty";
import { racePacing, type PacingTarget } from "./pacing";
import {
  comparePacing,
  RESULT_DISTANCE_TOLERANCE,
  type ActualEffort,
  type PacingResultInput,
} from "./pacing-result";

const bikeTarget = racePacing({
  sport: "Bike",
  distanceKm: 90,
  elevationM: 900,
  eventDays: 1,
  ftpWatts: 250,
  massKg: 75,
  thresholdPaceSecPerKm: null,
});

const runTarget = racePacing({
  sport: "Run",
  distanceKm: 21.1,
  elevationM: 150,
  eventDays: 1,
  ftpWatts: null,
  massKg: null,
  thresholdPaceSecPerKm: 240,
});

/** The predicted target as a plain value, for building expectations. */
function target(f: typeof bikeTarget): PacingTarget {
  if (!f.available) throw new Error("fixture prediction is unavailable");
  return f.value;
}

const BIKE = target(bikeTarget);
const RUN = target(runTarget);
if (BIKE.sport !== "Bike" || RUN.sport !== "Run") {
  throw new Error("fixture sports are wrong");
}

const effort = (over: Partial<ActualEffort> = {}): ActualEffort => ({
  provider: "intervals_icu",
  avgPower: BIKE.targetWatts,
  durationS: Math.round(BIKE.hours * 3600),
  distanceM: 90_000,
  ...over,
});

const bike = (over: Partial<PacingResultInput> = {}) =>
  comparePacing({
    predicted: bikeTarget,
    raceDistanceKm: 90,
    actual: effort(),
    ...over,
  });

const runEffort = (over: Partial<ActualEffort> = {}): ActualEffort => ({
  provider: "intervals_icu",
  avgPower: null,
  durationS: Math.round(RUN.targetSecPerKm * 21.1),
  distanceM: 21_100,
  ...over,
});

const run = (over: Partial<PacingResultInput> = {}) =>
  comparePacing({
    predicted: runTarget,
    raceDistanceKm: 21.1,
    actual: runEffort(),
    ...over,
  });

/**
 * Narrows to an available Bike comparison. `expect(...).toBe("Bike")` asserts
 * at runtime but does not narrow the union for TypeScript, so every property
 * access below it fails `tsc --noEmit` while vitest passes — the same trap
 * pacing.test.ts's `bikeValue` exists for.
 */
function bikeValue(r: ReturnType<typeof comparePacing>) {
  if (!r.available) throw new Error(`expected available, got ${r.kind}`);
  if (r.value.sport !== "Bike") throw new Error("expected a Bike comparison");
  return { value: r.value, confidence: r.confidence, why: r.why };
}

function runValue(r: ReturnType<typeof comparePacing>) {
  if (!r.available) throw new Error(`expected available, got ${r.kind}`);
  if (r.value.sport !== "Run") throw new Error("expected a Run comparison");
  return { value: r.value, confidence: r.confidence, why: r.why };
}

describe("comparePacing — Bike", () => {
  it("reports the actual against the predicted target and band", () => {
    const { value } = bikeValue(bike());
    expect(value.targetWatts).toBe(BIKE.targetWatts);
    expect(value.lowWatts).toBe(BIKE.lowWatts);
    expect(value.highWatts).toBe(BIKE.highWatts);
    expect(value.actualWatts).toBe(BIKE.targetWatts);
  });

  it("signs the delta so that harder is positive", () => {
    const { value } = bikeValue(
      bike({ actual: effort({ avgPower: BIKE.targetWatts + 20 }) })
    );
    expect(value.deltaWatts).toBe(20);
    expect(value.deltaPct).toBeGreaterThan(0);
  });

  it("signs the delta so that easier is negative", () => {
    const { value } = bikeValue(
      bike({ actual: effort({ avgPower: BIKE.targetWatts - 20 }) })
    );
    expect(value.deltaWatts).toBe(-20);
    expect(value.deltaPct).toBeLessThan(0);
  });

  it("calls a result inside the band inside", () => {
    expect(bikeValue(bike()).value.verdict).toBe("inside");
    // Both edges are inside, not out: the band is inclusive, and an athlete
    // who held exactly the bottom of it did what was asked.
    expect(
      bikeValue(bike({ actual: effort({ avgPower: BIKE.lowWatts }) })).value
        .verdict
    ).toBe("inside");
    expect(
      bikeValue(bike({ actual: effort({ avgPower: BIKE.highWatts }) })).value
        .verdict
    ).toBe("inside");
  });

  it("calls a result above the band harder, and below it easier", () => {
    expect(
      bikeValue(bike({ actual: effort({ avgPower: BIKE.highWatts + 1 }) }))
        .value.verdict
    ).toBe("harder");
    expect(
      bikeValue(bike({ actual: effort({ avgPower: BIKE.lowWatts - 1 }) })).value
        .verdict
    ).toBe("easier");
  });

  it("refuses a bike result with no power on file", () => {
    const r = bike({ actual: effort({ avgPower: null }) });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "missing_input") return;
    expect(r.needs).toMatch(/power/i);
  });
});

describe("comparePacing — Run", () => {
  it("reports the actual pace against the predicted target and band", () => {
    const { value } = runValue(run());
    expect(value.targetSecPerKm).toBe(RUN.targetSecPerKm);
    expect(value.actualSecPerKm).toBe(RUN.targetSecPerKm);
    expect(value.verdict).toBe("inside");
  });

  /**
   * THE MUTATION THIS FILE EXISTS FOR. For a run, LOWER seconds-per-km is a
   * HARDER effort — the one place where the raw delta's sign runs opposite to
   * the verdict. A comparison that copied the bike branch's `actual > high →
   * harder` reads every fast run as easy, and no type catches it.
   */
  it("calls a run FASTER than the band harder, not easier", () => {
    const { value } = runValue(
      run({ actual: runEffort({ durationS: (RUN.lowSecPerKm - 5) * 21.1 }) })
    );
    expect(value.actualSecPerKm).toBeLessThan(value.lowSecPerKm);
    expect(value.verdict).toBe("harder");
    // The raw delta keeps its own units: negative seconds-per-km IS faster.
    expect(value.deltaSecPerKm).toBeLessThan(0);
  });

  it("calls a run SLOWER than the band easier", () => {
    const { value } = runValue(
      run({ actual: runEffort({ durationS: (RUN.highSecPerKm + 5) * 21.1 }) })
    );
    expect(value.actualSecPerKm).toBeGreaterThan(value.highSecPerKm);
    expect(value.verdict).toBe("easier");
    expect(value.deltaSecPerKm).toBeGreaterThan(0);
  });

  it("paces the actual off the distance actually covered", () => {
    // 20 km in the time a 21.1 km race was predicted to take is a SLOWER pace
    // than the target, even though the elapsed time matches exactly.
    const { value } = runValue(
      run({
        actual: runEffort({ distanceM: 20_000 }),
        raceDistanceKm: 21.1,
      })
    );
    expect(value.actualSecPerKm).toBeGreaterThan(value.targetSecPerKm);
    expect(value.actualDistanceKm).toBeCloseTo(20, 5);
  });

  it("refuses a run result with no distance or no duration", () => {
    for (const missing of [{ distanceM: null }, { durationS: null }]) {
      const r = run({ actual: runEffort(missing) });
      expect(r.available).toBe(false);
      if (r.available || r.kind !== "missing_input") continue;
      expect(r.needs).toMatch(/distance|time/i);
    }
  });
});

describe("comparePacing — when it refuses", () => {
  it("passes the prediction's own refusal straight through", () => {
    const noFtp = racePacing({
      sport: "Bike",
      distanceKm: 90,
      elevationM: 900,
      eventDays: 1,
      ftpWatts: null,
      massKg: 75,
      thresholdPaceSecPerKm: null,
    });
    const r = comparePacing({
      predicted: noFtp,
      raceDistanceKm: 90,
      actual: effort(),
    });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "missing_input") return;
    // Not a second, vaguer reason of its own: there is no target to compare
    // against, and the athlete is told the same thing the race card tells
    // them, with the same fix link.
    expect(r.needs).toMatch(/FTP/i);
    expect(r.fix?.href).toBeTruthy();
  });

  it("refuses when no result is linked to the race yet", () => {
    const r = bike({ actual: null });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "missing_input") return;
    expect(r.needs).toMatch(/result/i);
  });

  /**
   * The Strava firewall (Nov 2024 API agreement), already enforced in
   * debrief.ts: a Strava result is LINKED as bookkeeping, but its numbers
   * never enter an AI-facing narrative. A comparison IS that narrative.
   */
  it("refuses a Strava result, naming the provider agreement", () => {
    const r = bike({ actual: effort({ provider: "strava" }) });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "not_applicable") return;
    expect(r.why).toMatch(/Strava/i);
    expect(r.why.length).toBeGreaterThan(30);
  });

  it("accepts a manual result — the firewall is Strava's, not every import's", () => {
    expect(bike({ actual: effort({ provider: "manual" }) }).available).toBe(
      true
    );
  });

  /**
   * A DNF, or an activity linked to the wrong race. "You held 8% under
   * target" would read as a verdict on the athlete's pacing rather than on a
   * race they did not finish.
   */
  it("refuses a result whose distance is nothing like the race's", () => {
    const r = bike({ actual: effort({ distanceM: 45_000 }) });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "not_applicable") return;
    // Both figures are named, so the athlete can see which one is wrong.
    expect(r.why).toMatch(/45/);
    expect(r.why).toMatch(/90/);
  });

  it("accepts a result inside the tolerance, and refuses just outside it", () => {
    const inside = 90 * (1 + RESULT_DISTANCE_TOLERANCE * 0.9);
    const outside = 90 * (1 + RESULT_DISTANCE_TOLERANCE * 1.1);
    expect(
      bike({ actual: effort({ distanceM: inside * 1000 }) }).available
    ).toBe(true);
    expect(
      bike({ actual: effort({ distanceM: outside * 1000 }) }).available
    ).toBe(false);
    // Short as well as long — a DNF is the case this is really for.
    expect(
      bike({
        actual: effort({
          distanceM: 90 * (1 - RESULT_DISTANCE_TOLERANCE * 1.1) * 1000,
        }),
      }).available
    ).toBe(false);
  });

  it("still compares when the result carries no distance at all", () => {
    // A trainer file with power but no distance is a real case, and the
    // mismatch guard has nothing to say about it — it must not refuse.
    expect(bike({ actual: effort({ distanceM: null }) }).available).toBe(true);
  });
});

describe("comparePacing — what it claims", () => {
  it("never claims more confidence than the prediction it is scoring", () => {
    const long = racePacing({
      sport: "Bike",
      distanceKm: 210,
      elevationM: 3500,
      eventDays: 1,
      ftpWatts: 250,
      massKg: 75,
      thresholdPaceSecPerKm: null,
    });
    if (!long.available) throw new Error("fixture unavailable");
    expect(long.confidence).toBe("low");
    const r = comparePacing({
      predicted: long,
      raceDistanceKm: 210,
      actual: effort({ distanceM: 210_000, avgPower: 170 }),
    });
    if (!r.available) throw new Error("expected a comparison");
    expect(r.confidence).toBe("low");
  });

  it("carries the prediction's assumption AND says the target was not recorded before the start", () => {
    const { why } = bikeValue(bike());
    expect(why).toContain(
      bikeTarget.available ? (bikeTarget.why as string) : ""
    );
    expect(why).toMatch(/not recorded|before the start/i);
  });

  it("compares a value, not a Figure — an unavailable actual is the caller's null", () => {
    // Guards the signature: `actual` is a plain effort or null, so a caller
    // cannot smuggle a Figure in and have it silently stringify.
    const input: PacingResultInput = {
      predicted: Figure.notApplicable("no"),
      raceDistanceKm: null,
      actual: null,
    };
    expect(comparePacing(input).available).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { racePacing, PACING_BAND_FRACTION } from "./pacing";
import { ftpFractionFor } from "./riding-time";

const bike = (over: Partial<Parameters<typeof racePacing>[0]> = {}) =>
  racePacing({
    sport: "Bike",
    distanceKm: 90,
    elevationM: 900,
    eventDays: 1,
    ftpWatts: 250,
    massKg: 75,
    thresholdPaceSecPerKm: null,
    ...over,
  });

/**
 * Narrows a result to an available Bike target. `expect(...).toBe("Bike")`
 * asserts at runtime but does not narrow the union for TypeScript, so every
 * property access below it fails `tsc --noEmit` while vitest passes — the
 * typecheck and the test runner disagreeing about the same line.
 */
function bikeValue(r: ReturnType<typeof racePacing>) {
  if (!r.available) throw new Error(`expected available, got ${r.kind}`);
  if (r.value.sport !== "Bike") throw new Error("expected a Bike target");
  return { value: r.value, confidence: r.confidence, why: r.why };
}

describe("racePacing — Bike", () => {
  it("targets a share of FTP, not FTP itself", () => {
    const { value } = bikeValue(bike());
    expect(value.sport).toBe("Bike");
    expect(value.targetWatts).toBeLessThan(250);
    expect(value.targetWatts).toBeGreaterThan(150);
  });

  // THE MUTATION THIS FILE EXISTS FOR. The likely defect is reading
  // INITIAL_FTP_FRACTION (0.75, the pre-iteration guess) instead of
  // ftpFractionFor(hours). A ~5h event resolves near 0.75, so a 5h fixture
  // CANNOT tell those apart — docs/RELEASING.md step 3 names exactly this
  // failure. These two sit where the values differ by 0.10 and 0.07.
  it("uses the resolved fraction, not the initial guess — short event", () => {
    const { value } = bikeValue(bike({ distanceKm: 55, elevationM: 300 }));
    expect(value.hours).toBeLessThan(3.5);
    expect(value.ftpFraction).toBeGreaterThan(0.8);
    expect(value.ftpFraction).toBe(ftpFractionFor(value.hours));
  });

  it("uses the resolved fraction, not the initial guess — long event", () => {
    const { value } = bikeValue(bike({ distanceKm: 210, elevationM: 3500 }));
    expect(value.hours).toBeGreaterThan(8);
    expect(value.ftpFraction).toBeCloseTo(0.68, 5);
    expect(value.ftpFraction).toBe(ftpFractionFor(value.hours));
  });

  it("brackets the target with a symmetric band", () => {
    const { targetWatts, lowWatts, highWatts } = bikeValue(bike()).value;
    expect(lowWatts).toBeLessThan(targetWatts);
    expect(highWatts).toBeGreaterThan(targetWatts);
    expect(targetWatts - lowWatts).toBeCloseTo(highWatts - targetWatts, 0);
    // Within 1 W, not exact: both ends are rounded to whole watts, which can
    // shave up to 1 W off the width. Whole watts is the right output — no
    // power meter shows tenths — so the tolerance belongs here, not a
    // fractional target in the implementation.
    expect(
      Math.abs(highWatts - lowWatts - 2 * targetWatts * PACING_BAND_FRACTION)
    ).toBeLessThanOrEqual(1);
  });

  it("reports low confidence past the 8h anchor, and says why", () => {
    const r = bikeValue(bike({ distanceKm: 210, elevationM: 3500 }));
    expect(r.confidence).toBe("low");
    expect(r.why).toMatch(/8 ?h|published/i);
  });

  it("reports medium confidence inside the anchors", () => {
    expect(bikeValue(bike()).confidence).toBe("medium");
  });
});

const run = (over: Partial<Parameters<typeof racePacing>[0]> = {}) =>
  racePacing({
    sport: "Run",
    distanceKm: 21.1,
    elevationM: 150,
    eventDays: 1,
    ftpWatts: null,
    massKg: null,
    thresholdPaceSecPerKm: 240,
    ...over,
  });

/** The Run counterpart of bikeValue — same narrowing reason. */
function runValue(r: ReturnType<typeof racePacing>) {
  if (!r.available) throw new Error(`expected available, got ${r.kind}`);
  if (r.value.sport !== "Run") throw new Error("expected a Run target");
  return { value: r.value, confidence: r.confidence, why: r.why };
}

describe("racePacing — Run", () => {
  it("targets a pace slower than threshold for a half marathon", () => {
    const { value } = runValue(run());
    expect(value.sport).toBe("Run");
    // Threshold is ~1h race pace; a half takes longer, so pace must be slower
    // (a HIGHER seconds-per-km) than the 240 anchor.
    expect(value.targetSecPerKm).toBeGreaterThan(240);
  });

  // Riegel decays pace with distance. A 10k must be paced faster than a
  // marathon off the same threshold, or the model is not being consulted.
  it("paces a 10k faster than a marathon", () => {
    const short = runValue(run({ distanceKm: 10, elevationM: 0 }));
    const long = runValue(run({ distanceKm: 42.2, elevationM: 0 }));
    expect(short.value.targetSecPerKm).toBeLessThan(long.value.targetSecPerKm);
  });

  // lowSecPerKm is the FAST end. Getting this backwards would tell an athlete
  // their easy end is their hard end, and no type would catch it.
  it("names the fast end low and the slow end high", () => {
    const { targetSecPerKm, lowSecPerKm, highSecPerKm } = runValue(run()).value;
    expect(lowSecPerKm).toBeLessThan(targetSecPerKm);
    expect(highSecPerKm).toBeGreaterThan(targetSecPerKm);
    expect(
      Math.abs(
        highSecPerKm - lowSecPerKm - 2 * targetSecPerKm * PACING_BAND_FRACTION
      )
    ).toBeLessThanOrEqual(1);
  });

  it("is medium confidence and cites Riegel", () => {
    const r = runValue(run());
    expect(r.confidence).toBe("medium");
    expect(r.why).toMatch(/Riegel/i);
  });

  it("refuses without a threshold pace", () => {
    const r = run({ thresholdPaceSecPerKm: null });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.kind).toBe("missing_input");
  });
});

describe("racePacing — when it refuses", () => {
  // Bike effort determines what is left for the run. A bike wattage computed
  // as though no run followed is not an incomplete answer, it is a harmful
  // one — so this refuses, and says why rather than showing a blank.
  it("refuses Triathlon, naming the bike-to-run coupling", () => {
    const r = racePacing({
      sport: "Triathlon",
      distanceKm: 113,
      elevationM: 900,
      eventDays: 1,
      ftpWatts: 250,
      massKg: 75,
      thresholdPaceSecPerKm: 240,
    });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.kind).toBe("not_applicable");
    if (r.kind !== "not_applicable") return;
    expect(r.why).toMatch(/run/i);
    expect(r.why.length).toBeGreaterThan(30);
  });

  // distanceKm is the TOTAL across days, so one sustainable intensity over it
  // is meaningless.
  it("refuses a multi-day event, naming the reason", () => {
    const r = racePacing({
      sport: "Bike",
      distanceKm: 600,
      elevationM: 9000,
      eventDays: 5,
      ftpWatts: 250,
      massKg: 75,
      thresholdPaceSecPerKm: null,
    });
    expect(r.available).toBe(false);
    if (r.available) return;
    expect(r.kind).toBe("not_applicable");
    if (r.kind !== "not_applicable") return;
    expect(r.why).toMatch(/day/i);
  });

  it("refuses a bike race with no FTP, and offers a fix", () => {
    const r = racePacing({
      sport: "Bike",
      distanceKm: 90,
      elevationM: 900,
      eventDays: 1,
      ftpWatts: null,
      massKg: 75,
      thresholdPaceSecPerKm: null,
    });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "missing_input") return;
    expect(r.needs).toMatch(/FTP/i);
    // The FIELD, not the page. `toBeTruthy()` passed against bare /settings,
    // which put the athlete at the top of the app's longest surface with the
    // drawer they needed closed and badged "FTP 250" — reading as done.
    expect(r.fix?.href).toBe("/settings?open=baselines#ftp-outdoor");
  });

  it("refuses a run with no threshold pace, and offers a fix", () => {
    const r = racePacing({
      sport: "Run",
      distanceKm: 21.1,
      elevationM: 0,
      eventDays: 1,
      ftpWatts: null,
      massKg: null,
      thresholdPaceSecPerKm: null,
    });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "missing_input") return;
    expect(r.needs).toMatch(/pace/i);
    // Its own field, not the FTP one — both anchors shared a single link
    // that named neither.
    expect(r.fix?.href).toBe("/settings?open=baselines#threshold-pace");
  });

  it("refuses with no distance", () => {
    const r = racePacing({
      sport: "Bike",
      distanceKm: null,
      elevationM: 0,
      eventDays: 1,
      ftpWatts: 250,
      massKg: 75,
      thresholdPaceSecPerKm: null,
    });
    expect(r.available).toBe(false);
    if (r.available || r.kind !== "missing_input") return;
    expect(r.needs).toMatch(/distance/i);
  });
});

describe("racePacing — a derived anchor caps confidence", () => {
  // schema.ts: "null = derive from history (Low confidence), then refuse".
  // The derivation happens in pacingAnchors; this is the second half of that
  // contract — a figure built on a Riegel-converted best effort must not be
  // reported with the same confidence as one the athlete measured and typed.
  it("drops a run to low confidence when the pace was derived", () => {
    const set = racePacing({
      sport: "Run",
      distanceKm: 21.1,
      elevationM: 0,
      eventDays: 1,
      ftpWatts: null,
      massKg: null,
      thresholdPaceSecPerKm: 240,
      runPaceAthleteSet: true,
    });
    const derived = racePacing({
      sport: "Run",
      distanceKm: 21.1,
      elevationM: 0,
      eventDays: 1,
      ftpWatts: null,
      massKg: null,
      thresholdPaceSecPerKm: 240,
      runPaceAthleteSet: false,
    });
    expect(set.available && derived.available).toBe(true);
    if (!set.available || !derived.available) return;
    expect(set.confidence).toBe("medium");
    expect(derived.confidence).toBe("low");
    expect(derived.why).toMatch(/estimat|recent runs/i);
  });

  it("drops a bike to low confidence when the FTP was not set", () => {
    const derived = racePacing({
      sport: "Bike",
      distanceKm: 90,
      elevationM: 900,
      eventDays: 1,
      ftpWatts: 250,
      massKg: 75,
      thresholdPaceSecPerKm: null,
      ftpSource: "synced",
    });
    expect(derived.available).toBe(true);
    if (!derived.available) return;
    expect(derived.confidence).toBe("low");
  });

  it("drops a bike to low confidence and names the indoor anchor, when FTP is indoor-sourced", () => {
    const r = racePacing({
      sport: "Bike",
      distanceKm: 90,
      elevationM: 900,
      eventDays: 1,
      ftpWatts: 235,
      massKg: 75,
      thresholdPaceSecPerKm: null,
      ftpSource: "indoor",
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.confidence).toBe("low");
    expect(r.why).toMatch(/indoor/i);
  });

  it("does not call a synced FTP 'indoor'", () => {
    const r = racePacing({
      sport: "Bike",
      distanceKm: 90,
      elevationM: 900,
      eventDays: 1,
      ftpWatts: 250,
      massKg: 75,
      thresholdPaceSecPerKm: null,
      ftpSource: "synced",
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.confidence).toBe("low");
    expect(r.why).not.toMatch(/indoor/i);
  });

  // Omitting the flags must not silently downgrade every existing caller.
  it("treats an unspecified flag as athlete-set", () => {
    const r = racePacing({
      sport: "Run",
      distanceKm: 21.1,
      elevationM: 0,
      eventDays: 1,
      ftpWatts: null,
      massKg: null,
      thresholdPaceSecPerKm: 240,
    });
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.confidence).toBe("medium");
  });
});

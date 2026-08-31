import { describe, it, expect } from "vitest";
import { matchWorkout } from "./match";
import type { LibraryWorkout } from "./types";

const W = (secs: number, lo: number, hi: number) => ({ secs, lo, hi });

const wk = (
  id: string,
  family: string,
  purpose: LibraryWorkout["purpose"],
  blocks: LibraryWorkout["blocks"]
): LibraryWorkout => ({
  id,
  name: id,
  purpose,
  family,
  why: "w",
  source: "Invented. Confidence: Low.",
  blocks,
});

// Spans, worked out from Task 1's rules:
//   ss-3x12  authored 75 min, flex 900s -> 67.5-82.5 min
//   ss-2x20  authored 74 min, flex 900s -> 66.5-81.5 min
//   thr-4x8  authored 72 min, flex 900s -> 64.5-79.5 min
//   ou-3x12  authored 51 min, flex 900s -> 43.5-58.5 min
//   end-2h   authored 100 min, flex 4800s -> 60-140 min
const STUB: LibraryWorkout[] = [
  wk("ss-3x12", "sweet-spot", "threshold", [
    { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
    { name: "Main set", repeat: 3, steps: [W(720, 88, 93), W(300, 55, 55)] },
    { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
  ]),
  wk("ss-2x20", "sweet-spot", "threshold", [
    { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
    { name: "Main set", repeat: 2, steps: [W(1200, 88, 93), W(300, 55, 55)] },
    { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
  ]),
  wk("thr-4x8", "threshold-blocks", "threshold", [
    { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
    { name: "Main set", repeat: 4, steps: [W(480, 95, 100), W(240, 55, 55)] },
    { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
  ]),
  wk("ou-3x12", "over-under", "threshold", [
    { name: "Warmup", repeat: 1, steps: [W(900, 50, 65)] },
    {
      name: "Main set",
      repeat: 3,
      steps: [W(120, 105, 105), W(120, 90, 90), W(300, 55, 55)],
    },
    { name: "Cooldown", repeat: 1, steps: [W(540, 50, 50)] },
  ]),
  wk("end-2h", "endurance", "aerobic_base", [
    { name: "Warmup", repeat: 1, steps: [W(600, 50, 60)] },
    { name: "Endurance", repeat: 1, steps: [W(4800, 60, 75)] },
    { name: "Cooldown", repeat: 1, steps: [W(600, 50, 50)] },
  ]),
  wk("unflexable", "broken", "vo2max", [
    { name: "Main set", repeat: 5, steps: [W(240, 110, 110), W(240, 50, 50)] },
  ]),
];

const BIKE = { sport: "Bike", purpose: "threshold" as const, durationMins: 75 };

describe("matchWorkout refusal", () => {
  it("refuses a session that is not cycling", () => {
    const r = matchWorkout(STUB, { ...BIKE, sport: "Run" }, "2026-09-01");
    expect(r).toEqual({ kind: "refused", reason: "not-cycling" });
  });

  it("refuses a purpose no library workout answers", () => {
    // brick is multi-sport; strength has strength/prescription.ts.
    for (const purpose of ["brick", "strength"] as const) {
      const r = matchWorkout(STUB, { ...BIKE, purpose }, "2026-09-01");
      expect(r).toEqual({ kind: "refused", reason: "not-a-library-purpose" });
    }
  });

  it("refuses when nothing in the library fits the day's length", () => {
    const r = matchWorkout(STUB, { ...BIKE, durationMins: 400 }, "2026-09-01");
    expect(r).toEqual({ kind: "refused", reason: "no-candidate" });
  });

  it("never offers a workout with nothing to flex", () => {
    // `unflexable` is the only vo2max workout in the stub, and it has no
    // repeat-1 block, so every vo2max day refuses.
    const r = matchWorkout(
      STUB,
      { sport: "Bike", purpose: "vo2max", durationMins: 60 },
      "2026-09-01"
    );
    expect(r).toEqual({ kind: "refused", reason: "no-candidate" });
  });
});

describe("matchWorkout selection", () => {
  it("returns blocks fitted to the day, not the authored blocks", () => {
    const r = matchWorkout(STUB, { ...BIKE, durationMins: 70 }, "2026-09-01");
    expect(r.kind).toBe("matched");
    if (r.kind !== "matched") return;
    const total = r.blocks.reduce(
      (t, b) => t + b.repeat * b.steps.reduce((x, s) => x + s.secs, 0),
      0
    );
    expect(total).toBe(4200);
  });

  it("is deterministic: the same day always gets the same workout", () => {
    // matchWorkout is pure, so repeating the call adds nothing beyond two —
    // either it always agrees or the purity claim itself is false.
    const first = matchWorkout(STUB, BIKE, "2026-09-01");
    for (let i = 0; i < 2; i++) {
      expect(matchWorkout(STUB, BIKE, "2026-09-01")).toEqual(first);
    }
  });

  it("gives different days different workouts", () => {
    const ids = new Set<string>();
    for (let d = 1; d <= 28; d++) {
      const date = `2026-09-${String(d).padStart(2, "0")}`;
      const r = matchWorkout(STUB, BIKE, date);
      if (r.kind === "matched") ids.add(r.workout.id);
    }
    expect(ids.size).toBeGreaterThan(1);
  });

  it("spreads across families rather than across ids", () => {
    // The sweet-spot family holds TWO candidates at 75 min and
    // threshold-blocks holds one, so the two rules differ measurably:
    // family-first gives sweet-spot ~50%, id-uniform would give ~66.7%.
    // ou-3x12 covers 43.5-58.5 and is correctly absent.
    const families = new Map<string, number>();
    const ids = new Map<string, number>();
    for (let d = 0; d < 364; d++) {
      const date = new Date(Date.UTC(2026, 0, 1 + d))
        .toISOString()
        .slice(0, 10);
      const r = matchWorkout(STUB, BIKE, date);
      if (r.kind === "matched") {
        families.set(
          r.workout.family,
          (families.get(r.workout.family) ?? 0) + 1
        );
        ids.set(r.workout.id, (ids.get(r.workout.id) ?? 0) + 1);
      }
    }
    expect([...families.keys()].sort()).toEqual([
      "sweet-spot",
      "threshold-blocks",
    ]);
    // The discriminating assertion: well under the 66.7% id-uniform would give.
    const sweetSpotShare = families.get("sweet-spot")! / 364;
    expect(sweetSpotShare).toBeGreaterThan(0.4);
    expect(sweetSpotShare).toBeLessThan(0.6);
    // And every workout in a multi-workout family must be reachable at all —
    // this is what the seed's missing avalanche used to make impossible.
    expect(ids.get("ss-3x12")).toBeGreaterThan(0);
    expect(ids.get("ss-2x20")).toBeGreaterThan(0);
  });

  it("reaches a workout at a length only it spans", () => {
    const r = matchWorkout(STUB, { ...BIKE, durationMins: 50 }, "2026-09-01");
    expect(r.kind).toBe("matched");
    if (r.kind !== "matched") return;
    expect(r.workout.id).toBe("ou-3x12");
  });
});

import { describe, expect, it } from "vitest";
import {
  detectOvertraining,
  MIN_HISTORY_DAYS,
  type BaselineInput,
  type WellnessDayInput,
} from "./overtraining";

// Baseline: ln-mean 4.174 ≈ hrv 65 ms, sd 0.1 → band low ≈ 58.8 ms.
const baseline: BaselineInput = {
  hrvLnMean: Math.log(65),
  hrvLnSd: 0.1,
  rhrMean: 48,
  rhrSd: 2,
};

const GOOD_HRV = 65; // inside band
const LOW_HRV = 50; // ln(50)=3.912 < 4.074 → suppressed

function days(
  hrvs: (number | null)[],
  rhrs?: (number | null)[]
): WellnessDayInput[] {
  return hrvs.map((hrv, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, "0")}`,
    hrvMs: hrv,
    restingHr: rhrs?.[i] ?? 48,
  }));
}

function history(suppressedTail: number, total = MIN_HISTORY_DAYS) {
  return days(
    Array.from({ length: total }, (_, i) =>
      i >= total - suppressedTail ? LOW_HRV : GOOD_HRV
    )
  );
}

describe("detectOvertraining", () => {
  it("triggers hrv_suppression at exactly 7 consecutive days, not 6", () => {
    expect(detectOvertraining(history(6), baseline)).toBeNull();
    expect(detectOvertraining(history(7), baseline)).toEqual({
      kind: "hrv_suppression",
      sinceDays: 7,
    });
    expect(detectOvertraining(history(9), baseline)).toEqual({
      kind: "hrv_suppression",
      sinceDays: 9,
    });
  });

  it("a recovered day resets the streak", () => {
    const d = history(9);
    d[d.length - 3].hrvMs = GOOD_HRV; // recovery 3 days ago → trailing run = 2
    expect(detectOvertraining(d, baseline)).toBeNull();
  });

  it("rhr spike triggers at +10 over baseline mean, not below", () => {
    const spiked = days(
      Array.from({ length: MIN_HISTORY_DAYS }, () => GOOD_HRV),
      Array.from({ length: MIN_HISTORY_DAYS }, (_, i) =>
        i >= MIN_HISTORY_DAYS - 3 ? 58 : 48
      )
    );
    expect(detectOvertraining(spiked, baseline)).toEqual({
      kind: "rhr_spike",
      sinceDays: 3,
    });
    const almost = days(
      Array.from({ length: MIN_HISTORY_DAYS }, () => GOOD_HRV),
      Array.from({ length: MIN_HISTORY_DAYS }, (_, i) =>
        i >= MIN_HISTORY_DAYS - 3 ? 57.9 : 48
      )
    );
    expect(detectOvertraining(almost, baseline)).toBeNull();
  });

  it("needs 21 days of history and complete baselines", () => {
    expect(detectOvertraining(history(8, 20), baseline)).toBeNull();
    expect(
      detectOvertraining(history(8), { ...baseline, hrvLnMean: null })
    ).toEqual(null);
  });

  it("hrv suppression wins when both signals fire", () => {
    const both = days(
      Array.from({ length: MIN_HISTORY_DAYS }, (_, i) =>
        i >= MIN_HISTORY_DAYS - 8 ? LOW_HRV : GOOD_HRV
      ),
      Array.from({ length: MIN_HISTORY_DAYS }, (_, i) =>
        i >= MIN_HISTORY_DAYS - 3 ? 60 : 48
      )
    );
    expect(detectOvertraining(both, baseline)).toEqual({
      kind: "hrv_suppression",
      sinceDays: 8,
    });
  });
});

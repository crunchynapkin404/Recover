import { describe, expect, it } from "vitest";
import { mapWithingsMeasures } from "./withings";

// Withings measure values are integers scaled by 10^unit. Type codes:
// 1=weight, 6=fat ratio, 9=diastolic, 10=systolic.
function grp(dateEpochS: number, measures: Array<[number, number, number]>) {
  return {
    date: dateEpochS,
    measures: measures.map(([value, type, unit]) => ({ value, type, unit })),
  };
}

// 2026-07-15 08:00:00 local-ish; test asserts on the resulting local day.
const T = Math.floor(new Date("2026-07-15T08:00:00").getTime() / 1000);

describe("mapWithingsMeasures", () => {
  it("scales measures by 10^unit and maps body + BP fields", () => {
    const days = mapWithingsMeasures({
      measuregrps: [
        grp(T, [
          [70200, 1, -3], // 70.2 kg
          [182, 6, -1], // 18.2 %
          [1180, 10, -1], // 118 systolic
          [740, 9, -1], // 74 diastolic
        ]),
      ],
    });
    const day = days.get("2026-07-15")!;
    expect(day.weightKg).toBe(70.2);
    expect(day.bodyFatPct).toBe(18.2);
    expect(day.systolic).toBe(118);
    expect(day.diastolic).toBe(74);
  });

  it("ignores unknown measure types", () => {
    const days = mapWithingsMeasures({
      measuregrps: [grp(T, [[76000, 76, -3]])], // muscle mass — not consumed
    });
    expect(days.size).toBe(0);
  });

  it("the latest group of the day wins for the same field", () => {
    const earlier = Math.floor(
      new Date("2026-07-15T07:00:00").getTime() / 1000
    );
    const later = Math.floor(new Date("2026-07-15T21:00:00").getTime() / 1000);
    const days = mapWithingsMeasures({
      measuregrps: [
        grp(later, [[71000, 1, -3]]),
        grp(earlier, [[70000, 1, -3]]),
      ],
    });
    expect(days.get("2026-07-15")!.weightKg).toBe(71);
  });

  it("separate days keep separate entries", () => {
    const day2 = Math.floor(new Date("2026-07-16T08:00:00").getTime() / 1000);
    const days = mapWithingsMeasures({
      measuregrps: [grp(T, [[70000, 1, -3]]), grp(day2, [[70500, 1, -3]])],
    });
    expect(days.get("2026-07-15")!.weightKg).toBe(70);
    expect(days.get("2026-07-16")!.weightKg).toBe(70.5);
  });

  it("handles an empty body", () => {
    expect(mapWithingsMeasures({}).size).toBe(0);
    expect(mapWithingsMeasures(undefined).size).toBe(0);
  });
});
